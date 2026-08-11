import { Button, Card, EmptyState, Field, Screen, Title, formatMoney, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import type { Order } from '@cleaning-go/types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text } from 'react-native';

type OrderWithWorkers = Order & { required_workers?: number };

const names: Record<string, string> = {
  searching: 'Ожидает компанию', accepted: 'Принят', on_the_way: 'В пути', arrived: 'Прибыл',
  in_progress: 'Уборка идёт', completed_by_cleaner: 'Ожидает подтверждения', completed: 'Завершён',
  cancelled: 'Отменён', disputed: 'Спор',
};

export default function Orders() {
  const role = useSessionStore((state) => state.profile?.role);
  const profileId = useSessionStore((state) => state.profile?.id);
  const demoOrders = useSessionStore((state) => state.demoOrders);
  const updateDemo = useSessionStore((state) => state.updateDemoOrderStatus);
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const router = useRouter();
  const [items, setItems] = useState<OrderWithWorkers[]>(demo ? demoOrders : []);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [workerLimits, setWorkerLimits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!demo);

  const load = useCallback(async () => {
    if (demo) {
      setItems(demoOrders);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (role === 'company_owner' && profileId) {
      const { data: company } = await supabase.from('company_profiles').select('id').eq('owner_id', profileId).single();
      setCompanyId(company?.id ?? null);
    }
    setLoading(false);
    if (error) Alert.alert('Не удалось загрузить', error.message);
    setItems((data ?? []) as OrderWithWorkers[]);
  }, [demo, demoOrders, profileId, role]);

  useFocusEffect(useCallback(() => {
    void load();
    if (demo) return;
    const channel = supabase.channel('orders-list').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, demo]));

  const canAccept = role === 'cleaner' || role === 'company_cleaner' || role === 'company_owner';

  async function accept(id: string) {
    if (demo) {
      updateDemo(id, 'accepted');
      void load();
      return;
    }
    if (role === 'company_owner' && !companyId) return Alert.alert('Компания не найдена', 'Обновите страницу и попробуйте снова.');
    const { error } = await supabase.rpc('accept_order', {
      target_order_id: id,
      target_company_id: role === 'company_owner' ? companyId : null,
    });
    if (error) Alert.alert('Не удалось принять', error.message);
    else void load();
  }

  async function quoteAndAccept(id: string) {
    const tenge = Number(prices[id]);
    const workers = Number(workerLimits[id] ?? '1');
    if (!Number.isFinite(tenge) || tenge < 100) return Alert.alert('Укажите цену', 'Введите итоговую цену заказа в тенге.');
    if (!Number.isInteger(workers) || workers < 1 || workers > 50) return Alert.alert('Укажите сотрудников', 'Введите количество сотрудников от 1 до 50 для этого заказа.');
    const { error } = await supabase.rpc('set_company_order_price', { target_order_id: id, target_total_minor: Math.round(tenge * 100), target_required_workers: workers });
    if (error) return Alert.alert('Не удалось назначить цену', error.message);
    await accept(id);
  }

  async function claimCompanyOrder(id: string) {
    const { error } = await supabase.rpc('claim_company_order', { target_order_id: id });
    if (error) Alert.alert('Не удалось взять работу', error.message);
    else {
      Alert.alert('Работа назначена', 'Теперь этот заказ закреплён за вами.');
      void load();
    }
  }

  return (
    <Screen>
      <Title subtitle={canAccept ? 'Заказы ваших клиентов и назначенные работы' : 'Следите за каждым этапом'}>Заказы</Title>
      {loading ? <Text>Загрузка…</Text> : items.length ? items.map((order) => (
        <Card key={order.id}>
          <Text style={s.cardTitle}>№ {order.order_number}</Text>
          <Text>{names[order.status] ?? order.status} · {order.total_minor > 0 ? formatMoney(order.total_minor) : 'цена ещё не назначена'}</Text>
          {order.required_workers ? <Text style={s.muted}>Нужно сотрудников: {order.required_workers}</Text> : null}
          <Text style={s.muted}>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</Text>
          {(role === 'cleaner' || role === 'company_cleaner') && order.status === 'accepted'
            ? <Button title="Взять работу" onPress={() => void claimCompanyOrder(order.id)} />
            : role === 'company_owner' && ['searching', 'offered'].includes(order.status)
            ? <><Field label="Итоговая цена, ₸" value={prices[order.id] ?? ''} onChangeText={(value) => setPrices((current) => ({ ...current, [order.id]: value }))} keyboardType="number-pad" placeholder="Например, 12000"/><Field label="Сколько сотрудников нужно" value={workerLimits[order.id] ?? '1'} onChangeText={(value) => setWorkerLimits((current) => ({ ...current, [order.id]: value }))} keyboardType="number-pad" placeholder="Например, 2"/><Button title="Указать цену, команду и принять" onPress={() => void quoteAndAccept(order.id)} /></>
            : canAccept && ['searching', 'offered'].includes(order.status)
              ? <Button title="Принять заказ" onPress={() => void accept(order.id)} />
            : <Button title="Открыть" variant="secondary" onPress={() => router.push(`/order/${order.id}`)} />}
        </Card>
      )) : <EmptyState title="Заказов пока нет" body={canAccept ? 'Новые заказы ваших клиентов появятся здесь.' : 'Создайте первый заказ с главной страницы.'} />}
    </Screen>
  );
}
