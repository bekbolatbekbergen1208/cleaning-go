import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { backend } from './backend';
const taskName = 'cleaning-go-active-order-location',
  orderKey = 'cleaning-go-tracked-order';
const activeStatuses = ['accepted', 'on_the_way', 'arrived', 'in_progress'];
let foreground: Location.LocationSubscription | null = null,
  foregroundOrder: string | null = null;
export async function stopOrderTracking() {
  foreground?.remove();
  foreground = null;
  foregroundOrder = null;
  if (
    Platform.OS !== 'web' &&
    (await TaskManager.isAvailableAsync()) &&
    (await Location.hasStartedLocationUpdatesAsync(taskName))
  )
    await Location.stopLocationUpdatesAsync(taskName);
  await AsyncStorage.removeItem(orderKey);
}
export async function isTrackingOrder(orderId: string) {
  if (foregroundOrder === orderId && foreground) return true;
  return (
    Platform.OS !== 'web' &&
    (await TaskManager.isAvailableAsync()) &&
    (await AsyncStorage.getItem(orderKey)) === orderId &&
    (await Location.hasStartedLocationUpdatesAsync(taskName))
  );
}
async function publish(orderId: string, latest: Location.LocationObject) {
  const {
    data: { session },
    error: sessionError,
  } = await backend.auth.getSession();
  if (sessionError) return;
  if (!session) {
    await stopOrderTracking();
    return;
  }
  const { data: cleaner, error: cleanerError } = await backend
    .from('cleaner_profiles')
    .select('is_available,workday_ends_at')
    .eq('user_id', session.user.id)
    .single();
  if (cleanerError) return;
  if (
    !cleaner?.is_available ||
    !cleaner.workday_ends_at ||
    Date.parse(cleaner.workday_ends_at) <= Date.now()
  ) {
    await stopOrderTracking();
    return;
  }
  const { data: order, error: orderError } = await backend
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) return;
  if (!order || !activeStatuses.includes(order.status)) {
    await stopOrderTracking();
    return;
  }
  const { error } = await backend.rpc('update_cleaner_location', {
    target_order_id: orderId,
    lat: latest.coords.latitude,
    lng: latest.coords.longitude,
    target_heading: latest.coords.heading,
    target_speed: latest.coords.speed,
  });
  if (error && /workday|inactive|ended|sharing/i.test(error.message))
    await stopOrderTracking();
}
export async function startOrderTracking(
  orderId: string,
): Promise<'foreground' | 'background'> {
  if (Platform.OS === 'web')
    throw new Error('Передача GPS доступна в мобильном приложении Android.');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Разрешите доступ к геолокации.');
  const {
    data: { user },
    error: authError,
  } = await backend.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Войдите в аккаунт клинера.');
  const { data: cleaner } = await backend
    .from('cleaner_profiles')
    .select('is_available,workday_ends_at')
    .eq('user_id', user.id)
    .single();
  if (
    !cleaner?.is_available ||
    !cleaner.workday_ends_at ||
    Date.parse(cleaner.workday_ends_at) <= Date.now()
  )
    throw new Error('Сначала начните рабочий день в профиле.');
  const { data: order } = await backend
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single();
  if (!order || !activeStatuses.includes(order.status))
    throw new Error('Этот заказ больше не отслеживается.');
  const [{ data: worker }, { data: assignment }] = await Promise.all([
    backend
      .from('order_workers')
      .select('cleaner_id')
      .eq('order_id', orderId)
      .eq('cleaner_id', user.id)
      .maybeSingle(),
    backend
      .from('order_assignments')
      .select('cleaner_id')
      .eq('order_id', orderId)
      .eq('cleaner_id', user.id)
      .eq('is_active', true)
      .maybeSingle(),
  ]);
  if (!worker && !assignment) throw new Error('Вы не назначены на этот заказ.');
  const initial = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const { error } = await backend.rpc('update_cleaner_location', {
    target_order_id: orderId,
    lat: initial.coords.latitude,
    lng: initial.coords.longitude,
    target_heading: initial.coords.heading,
    target_speed: initial.coords.speed,
  });
  if (error) throw new Error(error.message);
  await stopOrderTracking();
  const backgroundAvailable = await TaskManager.isAvailableAsync();
  if (backgroundAvailable) {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.granted) {
      await AsyncStorage.setItem(orderKey, orderId);
      try {
        await Location.startLocationUpdatesAsync(taskName, {
          accuracy: Location.Accuracy.High,
          timeInterval: 15000,
          distanceInterval: 10,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Cleaning Go: рабочий маршрут',
            notificationBody:
              'Геолокация передаётся участникам активного заказа до конца смены.',
          },
        });
        return 'background';
      } catch {
        await AsyncStorage.removeItem(orderKey);
      }
    }
  }
  foregroundOrder = orderId;
  try {
    foreground = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 15000,
        distanceInterval: 10,
      },
      (location) => {
        void publish(orderId, location).catch(() => {});
      },
    );
  } catch (error) {
    foregroundOrder = null;
    throw error;
  }
  return 'foreground';
}
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  taskName,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const orderId = await AsyncStorage.getItem(orderKey);
    if (!orderId) return;
    try {
      await publish(orderId, data.locations[data.locations.length - 1]);
    } catch {
      /* Retry after transient network failures. */
    }
  },
);
