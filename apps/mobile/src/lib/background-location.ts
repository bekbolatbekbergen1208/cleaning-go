import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const taskName = 'cleaning-go-active-order-location';
const orderKey = 'cleaning-go-tracked-order';
const activeStatuses = ['accepted', 'on_the_way', 'arrived', 'in_progress'];

export async function stopOrderTracking() {
  if (Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(taskName)) {
    await Location.stopLocationUpdatesAsync(taskName);
  }
  await AsyncStorage.removeItem(orderKey);
}

export async function isTrackingOrder(orderId: string) {
  return Platform.OS !== 'web' && (await AsyncStorage.getItem(orderKey)) === orderId
    && await Location.hasStartedLocationUpdatesAsync(taskName);
}

export async function startOrderTracking(orderId: string) {
  if (Platform.OS === 'web') throw new Error('Фоновая геолокация доступна в установленном мобильном приложении.');
  if (!await TaskManager.isAvailableAsync()) throw new Error('Фоновая геолокация недоступна в Expo Go. Установите сборку Cleaning Go.');
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('Разрешите доступ к геолокации.');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error('Разрешите геолокацию в фоне в настройках телефона.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Войдите в аккаунт клинера.');
  const { data: cleaner } = await supabase.from('cleaner_profiles').select('is_available,workday_ends_at').eq('user_id', user.id).single();
  if (!cleaner?.is_available || !cleaner.workday_ends_at || Date.parse(cleaner.workday_ends_at) <= Date.now()) {
    throw new Error('Сначала начните рабочий день в профиле.');
  }
  const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (!order || !activeStatuses.includes(order.status)) throw new Error('Этот заказ больше не отслеживается.');
  const [{ data: worker }, { data: assignment }] = await Promise.all([
    supabase.from('order_workers').select('cleaner_id').eq('order_id', orderId).eq('cleaner_id', user.id).maybeSingle(),
    supabase.from('order_assignments').select('cleaner_id').eq('order_id', orderId).eq('cleaner_id', user.id).eq('is_active', true).maybeSingle(),
  ]);
  if (!worker && !assignment) throw new Error('Вы не назначены на этот заказ.');
  const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const { error: initialError } = await supabase.rpc('update_cleaner_location', {
    target_order_id: orderId, lat: initial.coords.latitude, lng: initial.coords.longitude,
    target_heading: initial.coords.heading, target_speed: initial.coords.speed,
  });
  if (initialError) throw new Error(initialError.message);
  await stopOrderTracking();
  await AsyncStorage.setItem(orderKey, orderId);
  try {
    await Location.startLocationUpdatesAsync(taskName, {
      accuracy: Location.Accuracy.High,
      timeInterval: 15_000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Cleaning Go: рабочий маршрут',
        notificationBody: 'Ваше местоположение передаётся участникам активного заказа до конца смены.',
      },
    });
  } catch (error) {
    await AsyncStorage.removeItem(orderKey);
    throw error;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(taskName, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const orderId = await AsyncStorage.getItem(orderKey);
  if (!orderId) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return void await stopOrderTracking();
    const { data: cleaner } = await supabase.from('cleaner_profiles').select('is_available,workday_ends_at').eq('user_id', session.user.id).single();
    if (!cleaner?.is_available || !cleaner.workday_ends_at || Date.parse(cleaner.workday_ends_at) <= Date.now()) return void await stopOrderTracking();
    const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).single();
    if (!order || !activeStatuses.includes(order.status)) return void await stopOrderTracking();
    const latest = data.locations[data.locations.length - 1];
    const { error: updateError } = await supabase.rpc('update_cleaner_location', {
      target_order_id: orderId,
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      target_heading: latest.coords.heading,
      target_speed: latest.coords.speed,
    });
    if (updateError && /workday|inactive|ended|sharing/i.test(updateError.message)) await stopOrderTracking();
  } catch {
    // A transient network error must not discard the cleaner's active route.
  }
});
