import { TwoGisMap } from '@/components/two-gis-map';
import { Button, Card, Field, Screen, Title, formatMoney, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import type { Order, OrderStatus } from '@cleaning-go/types';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

const next: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  accepted: { status: 'on_the_way', label: 'Начать маршрут' }, on_the_way: { status: 'arrived', label: 'Я прибыл' },
  arrived: { status: 'in_progress', label: 'Начать уборку' }, in_progress: { status: 'completed_by_cleaner', label: 'Уборка завершена' },
  completed_by_cleaner: { status: 'completed', label: 'Подтвердить завершение' },
};
const trackingStatuses: OrderStatus[] = ['on_the_way', 'arrived', 'in_progress'];
type Point = { latitude: number; longitude: number; recorded_at: string };

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useSessionStore(state => state.profile?.role);
  const demoOrders = useSessionStore(state => state.demoOrders);
  const updateDemo = useSessionStore(state => state.updateDemoOrderStatus);
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const [order, setOrder] = useState<Order | undefined>(demo ? demoOrders.find(item => item.id === id) : undefined);
  const [point, setPoint] = useState<Point>(); const [rating, setRating] = useState('5'); const [review, setReview] = useState('');
  const executor = role === 'cleaner' || role === 'company_cleaner' || role === 'company_owner';
  const isCleaner = role === 'cleaner' || role === 'company_cleaner';

  async function load() {
    if (demo) return setOrder(demoOrders.find(item => item.id === id));
    const { data, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error) Alert.alert('Ошибка', error.message); else setOrder(data as Order);
  }

  useEffect(() => {
    void load(); if (demo) return;
    const channel = supabase.channel(`order-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, payload => setOrder(payload.new as Order))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cleaner_locations', filter: `order_id=eq.${id}` }, payload => setPoint(payload.new as Point)).subscribe();
    void supabase.from('cleaner_locations').select('latitude,longitude,recorded_at').eq('order_id', id).maybeSingle().then(({ data }) => data && setPoint(data));
    return () => { void supabase.removeChannel(channel); };
  }, [id, demo, demoOrders]);

  useEffect(() => {
    if (demo || !isCleaner || !order || !trackingStatuses.includes(order.status)) return;
    let watcher: Location.LocationSubscription | undefined; let cancelled = false;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted' || cancelled) return;
      watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 15_000, distanceInterval: 10 }, location => {
        void supabase.rpc('update_cleaner_location', { target_order_id: id, lat: location.coords.latitude, lng: location.coords.longitude, target_heading: location.coords.heading, target_speed: location.coords.speed });
      });
    })();
    return () => { cancelled = true; watcher?.remove(); };
  }, [demo, id, isCleaner, order?.status]);

  async function transition(status: OrderStatus) {
    if (demo) { updateDemo(id, status); setOrder(current => current ? { ...current, status } : current); return; }
    if (status === 'on_the_way') { const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted') return Alert.alert('Нужно разрешение', 'Разрешите геолокацию для запуска маршрута.'); }
    const { error } = await supabase.rpc('transition_order_status', { target_order_id: id, next_status: status, note: null });
    if (error) return Alert.alert('Переход недоступен', error.message);
    void load();
    if (status === 'on_the_way') {
      const destination = [order?.city, order?.address_text].filter(Boolean).join(', ');
      const twoGisUrl = `https://2gis.kz/search/${encodeURIComponent(destination)}`;
      const opened = await Linking.openURL(twoGisUrl).then(() => true).catch(() => false);
      if (!opened) Alert.alert('2GIS не открылся', 'Геопозиция всё равно передаётся клиенту через Cleaning Go.');
    }
  }
  async function sendReview() {
    if (demo) return Alert.alert('Спасибо', 'Отзыв опубликован в демо-режиме.');
    const { error } = await supabase.rpc('create_review', { target_order_id: id, target_rating: Number(rating), target_text: review, target_tags: ['рекомендую'] });
    Alert.alert(error ? 'Ошибка' : 'Спасибо', error?.message ?? 'Отзыв опубликован');
  }

  if (!order) return <Screen><Text>Загрузка заказа…</Text></Screen>;
  const action = next[order.status]; const showAction = action && ((executor && action.status !== 'completed') || (!executor && action.status === 'completed'));
  return <Screen><Title subtitle={`Статус: ${order.status}`}>№ {order.order_number}</Title>
    <Card><Text style={s.cardTitle}>{order.address_text}</Text><Text>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</Text><Text>{order.area_sq_m} м² · {order.rooms_count} комн.</Text><Text style={s.cardTitle}>{formatMoney(order.total_minor)}</Text></Card>
    {point ? <Card><Text style={s.cardTitle}>Клинер на карте 2GIS</Text><TwoGisMap latitude={point.latitude} longitude={point.longitude} /><Text style={s.muted}>Обновлено {new Date(point.recorded_at).toLocaleTimeString('ru-KZ')}</Text><Button title="Открыть в 2GIS" variant="secondary" onPress={() => void Linking.openURL(`https://2gis.kz/search/${point.latitude},${point.longitude}`)} /></Card> : trackingStatuses.includes(order.status) ? <Card><Text>Ожидаем первую точку геолокции…</Text></Card> : null}
    {showAction ? <Button title={action.label} onPress={() => void transition(action.status)} /> : null}
    {!executor && ['created', 'searching'].includes(order.status) ? <Button title="Отменить заказ" variant="danger" onPress={() => void transition('cancelled')} /> : null}
    {!executor && order.status === 'completed' ? <Card><Text style={s.cardTitle}>Оцените уборку</Text><View style={s.row}>{[1,2,3,4,5].map(value => <Button key={value} title={String(value)} variant={rating === String(value) ? 'primary' : 'secondary'} onPress={() => setRating(String(value))} />)}</View><Field label="Отзыв" value={review} onChangeText={setReview} /><Button title="Опубликовать отзыв" onPress={() => void sendReview()} /></Card> : null}
  </Screen>;
}
