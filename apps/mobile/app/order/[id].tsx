import { TwoGisMap, hasTwoGisKey } from '@/components/two-gis-map';
import {
  Button,
  Card,
  Field,
  Screen,
  Title,
  formatMoney,
  s,
} from '@/components/ui';
import { backend } from '@/lib/backend';
import { useSessionStore } from '@/store/session';
import type { Order, OrderStatus } from '@cleaning-go/types';
import {
  isTrackingOrder,
  startOrderTracking,
  stopOrderTracking,
} from '@/lib/background-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

const next: Partial<
  Record<OrderStatus, { status: OrderStatus; label: string }>
> = {
  accepted: { status: 'on_the_way', label: 'Начать маршрут' },
  on_the_way: { status: 'arrived', label: 'Я прибыл' },
  arrived: { status: 'in_progress', label: 'Начать уборку' },
  in_progress: { status: 'completed_by_cleaner', label: 'Уборка завершена' },
  completed_by_cleaner: {
    status: 'completed',
    label: 'Подтвердить завершение',
  },
};
const trackingStatuses: OrderStatus[] = [
  'accepted',
  'on_the_way',
  'arrived',
  'in_progress',
];
type Point = {
  cleaner_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useSessionStore((state) => state.profile?.role);
  const demoOrders = useSessionStore((state) => state.demoOrders);
  const updateDemo = useSessionStore((state) => state.updateDemoOrderStatus);
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const [order, setOrder] = useState<Order | undefined>(
    demo ? demoOrders.find((item) => item.id === id) : undefined,
  );
  const [tracking, setTracking] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [rating, setRating] = useState('5');
  const [review, setReview] = useState('');
  const [complaint, setComplaint] = useState('');
  const executor =
    role === 'cleaner' ||
    role === 'company_cleaner' ||
    role === 'company_owner';
  const isCleaner = role === 'cleaner' || role === 'company_cleaner';

  async function load() {
    if (demo) return setOrder(demoOrders.find((item) => item.id === id));
    const { data, error } = await backend
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    if (error) Alert.alert('Ошибка', error.message);
    else setOrder(data as Order);
  }

  async function loadPoints() {
    const { data } = await backend
      .from('cleaner_locations')
      .select('cleaner_id,latitude,longitude,recorded_at')
      .eq('order_id', id);
    setPoints(
      ((data ?? []) as Point[]).filter(
        (point) => Date.now() - Date.parse(point.recorded_at) <= 120_000,
      ),
    );
  }

  useEffect(() => {
    void load();
    if (demo) return;
    const channel = backend
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => setOrder(payload.new as Order),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cleaner_locations',
          filter: `order_id=eq.${id}`,
        },
        () => void loadPoints(),
      )
      .subscribe();
    void loadPoints();
    const poll = setInterval(() => void loadPoints(), 10_000);
    return () => {
      clearInterval(poll);
      void backend.removeChannel(channel);
    };
  }, [id, demo, demoOrders]);

  useEffect(() => {
    if (demo || !isCleaner || !id) return;
    void isTrackingOrder(id).then(setTracking);
  }, [demo, id, isCleaner]);

  useEffect(() => {
    if (
      demo ||
      !isCleaner ||
      !tracking ||
      !order ||
      trackingStatuses.includes(order.status)
    )
      return;
    void stopOrderTracking().then(() => setTracking(false));
  }, [demo, isCleaner, tracking, order?.status]);

  async function toggleTracking() {
    try {
      if (tracking) {
        await stopOrderTracking();
        setTracking(false);
      } else {
        const mode = await startOrderTracking(id);
        setTracking(true);
        if (mode === 'foreground')
          Alert.alert(
            'GPS включён',
            'Оставьте приложение открытым. Для передачи при заблокированном экране нужна установленная сборка с фоновым доступом.',
          );
      }
    } catch (error) {
      Alert.alert(
        'Геолокация',
        error instanceof Error
          ? error.message
          : 'Не удалось запустить отслеживание.',
      );
    }
  }

  async function transition(status: OrderStatus) {
    if (demo) {
      updateDemo(id, status);
      setOrder((current) => (current ? { ...current, status } : current));
      return;
    }
    let completionPaths: string[] = [];
    if (isCleaner && order?.selected_company_id && status === 'completed_by_cleaner') {
      try {
        const picker = await import('expo-image-picker');
        const permission = await picker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return Alert.alert('Фотоотчёт', 'Разрешите выбор фото для завершения заказа.');
        const photo = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
        if (photo.canceled || !photo.assets[0]) return;
        const { data: { user } } = await backend.auth.getUser();
        if (!user) return Alert.alert('Нужно войти');
        const asset = photo.assets[0];
        const file = await (await fetch(asset.uri)).blob();
        const path = `${user.id}/completion-${id}-${Date.now()}.jpg`;
        const { error: uploadError } = await backend.storage.from('order-photos').upload(path, file, { contentType: asset.mimeType || 'image/jpeg' });
        if (uploadError) return Alert.alert('Фотоотчёт', uploadError.message);
        completionPaths = [path];
      } catch { return Alert.alert('Фотоотчёт', 'Не удалось загрузить фото. Повторите попытку.'); }
    }
    const companyStep = isCleaner && order?.selected_company_id && ['on_the_way', 'arrived', 'in_progress', 'completed_by_cleaner'].includes(status);
    const { error } = companyStep
      ? await backend.rpc('advance_company_order', { target_order_id: id, completion_paths: completionPaths, expected_status: order?.status })
      : await backend.rpc('transition_order_status', { target_order_id: id, next_status: status, note: null });
    if (error) { void load(); return Alert.alert('Переход недоступен', error.message); }
    void load();
    if (status === 'on_the_way') {
      const destination = [order?.city, order?.address_text]
        .filter(Boolean)
        .join(', ');
      const twoGisUrl = `https://2gis.kz/search/${encodeURIComponent(destination)}`;
      const opened = await Linking.openURL(twoGisUrl)
        .then(() => true)
        .catch(() => false);
      if (!opened)
        Alert.alert(
          '2GIS не открылся',
          'Откройте адрес заказа в навигаторе вручную.',
        );
    }
  }
  async function confirmPrice() {
    const { error } = await backend.rpc('confirm_company_order_price', {
      target_order_id: id, expected_quote_version: order?.quote_version,
    });
    if (error) Alert.alert('Не удалось подтвердить цену', error.message);
    void load();
  }

  async function openDispute() {
    if (complaint.trim().length < 10)
      return Alert.alert(
        'Опишите проблему',
        'Введите описание не короче 10 символов.',
      );
    const { error } = await backend.rpc('open_dispute', {
      target_order_id: id,
      target_reason: 'other',
      target_description: complaint.trim(),
    });
    if (error) Alert.alert('Не удалось открыть спор', error.message);
    else {
      setComplaint('');
      void load();
      Alert.alert(
        'Обращение отправлено',
        'Администратор рассмотрит ваше обращение.',
      );
    }
  }
  async function sendReview() {
    if (demo) return Alert.alert('Спасибо', 'Отзыв опубликован в демо-режиме.');
    const { error } = await backend.rpc('create_review', {
      target_order_id: id,
      target_rating: Number(rating),
      target_text: review,
      target_tags: ['рекомендую'],
    });
    Alert.alert(
      error ? 'Ошибка' : 'Спасибо',
      error?.message ?? 'Отзыв опубликован',
    );
  }

  if (!order)
    return (
      <Screen>
        <Text>Загрузка заказа…</Text>
      </Screen>
    );
  const action = next[order.status];
  const showAction =
    action &&
    ((executor && action.status !== 'completed') ||
      (!executor && action.status === 'completed'));
  return (
    <Screen>
      <Title subtitle={`Статус: ${order.status}`}>№ {order.order_number}</Title>
      <Card>
        <Text style={s.cardTitle}>{order.address_text}</Text>
        <Text>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</Text>
        <Text>
          {order.area_sq_m} м² · {order.rooms_count} комн.
        </Text>
        <Text style={s.cardTitle}>{formatMoney(order.total_minor)}</Text>
      </Card>
      {trackingStatuses.includes(order.status) && points.length ? (
        points.map((point) => (
          <Card key={point.cleaner_id}>
            <Text style={s.cardTitle}>{hasTwoGisKey() ? 'Клинер на карте 2GIS' : 'Клинер на карте'}</Text>
            <TwoGisMap latitude={point.latitude} longitude={point.longitude} />
            <Text style={s.muted}>
              Обновлено{' '}
              {new Date(point.recorded_at).toLocaleTimeString('ru-KZ')}
            </Text>
            <Button
              title="Открыть в 2GIS"
              variant="secondary"
              onPress={() =>
                void Linking.openURL(
                  `https://2gis.kz/search/${point.latitude},${point.longitude}`,
                )
              }
            />
          </Card>
        ))
      ) : trackingStatuses.includes(order.status) ? (
        <Card>
          <Text>Ожидаем первую точку геолокции…</Text>
        </Card>
      ) : null}
      {isCleaner && trackingStatuses.includes(order.status) && !demo ? (
        <Card>
          <Text style={s.cardTitle}>Передача геолокации</Text>
          <Text style={s.muted}>
            Доступна участникам заказа и компании до конца рабочей смены. Для
            работы при заблокированном экране разрешите геолокацию в фоне.
          </Text>
          <Button
            title={tracking ? 'Остановить передачу GPS' : 'Начать передачу GPS'}
            variant={tracking ? 'danger' : 'primary'}
            onPress={() => void toggleTracking()}
          />
        </Card>
      ) : null}
      {!executor && order.status === 'offered' ? (
        <Button
          title="Подтвердить цену и заказать уборку"
          onPress={() => void confirmPrice()}
        />
      ) : null}
      {showAction ? (
        <Button
          title={action.label}
          onPress={() => void transition(action.status)}
        />
      ) : null}
      {!executor &&
      ['created', 'searching', 'offered'].includes(order.status) ? (
        <Button
          title="Отменить заказ"
          variant="danger"
          onPress={() => void transition('cancelled')}
        />
      ) : null}
      {!executor && order.status === 'completed' ? (
        <Card>
          <Text style={s.cardTitle}>Оцените уборку</Text>
          <View style={s.row}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Button
                key={value}
                title={String(value)}
                variant={rating === String(value) ? 'primary' : 'secondary'}
                onPress={() => setRating(String(value))}
              />
            ))}
          </View>
          <Field label="Отзыв" value={review} onChangeText={setReview} />
          <Button
            title="Опубликовать отзыв"
            onPress={() => void sendReview()}
          />
        </Card>
      ) : null}
      {[
        'accepted',
        'on_the_way',
        'arrived',
        'in_progress',
        'completed_by_cleaner',
        'completed',
      ].includes(order.status) ? (
        <Card>
          <Text style={s.cardTitle}>Проблема с заказом?</Text>
          <Field
            label="Описание проблемы"
            value={complaint}
            onChangeText={setComplaint}
            multiline
          />
          <Button
            title="Открыть спор"
            variant="secondary"
            onPress={() => void openDispute()}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
