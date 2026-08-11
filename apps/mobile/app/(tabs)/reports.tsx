import { Button, Card, EmptyState, Screen, Title, formatMoney, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Period = 7 | 30 | 0;
type ReportOrder = {
  id: string;
  client_id: string;
  status: string;
  total_minor: number;
  executor_amount_minor: number;
  company_cashback_minor?: number;
  created_at: string;
  completed_at: string | null;
};

export default function Reports() {
  const role = useSessionStore((state) => state.profile?.role);
  const demoOrders = useSessionStore((state) => state.demoOrders);
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const [period, setPeriod] = useState<Period>(30);
  const [orders, setOrders] = useState<ReportOrder[]>([]);
  const [employees, setEmployees] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (role !== 'company_owner') return;
    if (demo) {
      setOrders(demoOrders.map((order) => ({ ...order, created_at: new Date().toISOString(), completed_at: order.status === 'completed' ? new Date().toISOString() : null })) as ReportOrder[]);
      setEmployees(3);
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase.from('orders').select('id,client_id,status,total_minor,executor_amount_minor,company_cashback_minor,created_at,completed_at').order('created_at', { ascending: false }).then(async ({ data }) => {
      setOrders((data ?? []) as ReportOrder[]);
      const { data: company } = await supabase.from('company_profiles').select('id').single();
      if (company) {
        const { count } = await supabase.from('company_cleaners').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('is_active', true);
        setEmployees(count ?? 0);
      }
      setLoading(false);
    });
  }, [demo, demoOrders, role]));

  const filtered = useMemo(() => {
    if (!period) return orders;
    const after = Date.now() - period * 86400000;
    return orders.filter((order) => new Date(order.created_at).getTime() >= after);
  }, [orders, period]);

  const report = useMemo(() => {
    const completed = filtered.filter((order) => order.status === 'completed');
    const revenue = completed.reduce((sum, order) => sum + Number(order.executor_amount_minor || order.total_minor || 0), 0);
    const cashback = completed.reduce((sum, order) => sum + Number(order.company_cashback_minor ?? 0), 0);
    return {
      total: filtered.length,
      completed: completed.length,
      active: filtered.filter((order) => !['completed', 'cancelled'].includes(order.status)).length,
      cancelled: filtered.filter((order) => order.status === 'cancelled').length,
      clients: new Set(filtered.map((order) => order.client_id)).size,
      revenue,
      cashback,
      average: completed.length ? Math.round(revenue / completed.length) : 0,
      completionRate: filtered.length ? Math.round(completed.length / filtered.length * 100) : 0,
    };
  }, [filtered]);

  if (role !== 'company_owner') return <Screen><EmptyState title="Отчёты компании" body="Раздел доступен владельцу клининговой компании." /></Screen>;

  return (
    <Screen>
      <Title subtitle="Показатели рассчитываются автоматически по заказам">Отчёты</Title>
      <View style={x.periods}>
        <Button title="7 дней" variant={period === 7 ? 'primary' : 'secondary'} onPress={() => setPeriod(7)} />
        <Button title="30 дней" variant={period === 30 ? 'primary' : 'secondary'} onPress={() => setPeriod(30)} />
        <Button title="Всё время" variant={period === 0 ? 'primary' : 'secondary'} onPress={() => setPeriod(0)} />
      </View>
      {loading ? <Text style={s.muted}>Формируем отчёт…</Text> : <>
        <View style={x.grid}>
          <View style={x.metricCard}><Text style={x.metric}>{report.total}</Text><Text style={x.metricLabel}>Всего заказов</Text></View>
          <View style={x.metricCard}><Text style={x.metric}>{report.active}</Text><Text style={x.metricLabel}>Активных</Text></View>
          <View style={x.metricCard}><Text style={x.metric}>{report.completed}</Text><Text style={x.metricLabel}>Завершено</Text></View>
          <View style={x.metricCard}><Text style={x.metric}>{report.clients}</Text><Text style={x.metricLabel}>Клиентов</Text></View>
        </View>
        <Card>
          <Text style={s.cardTitle}>Финансы</Text>
          <View style={x.line}><Text style={s.muted}>Выручка компании</Text><Text style={x.value}>{formatMoney(report.revenue)}</Text></View>
          <View style={x.line}><Text style={s.muted}>Средний чек</Text><Text style={x.value}>{formatMoney(report.average)}</Text></View>
          <View style={x.line}><Text style={s.muted}>Кешбэк клиентам</Text><Text style={x.value}>{formatMoney(report.cashback)}</Text></View>
        </Card>
        <Card>
          <Text style={s.cardTitle}>Эффективность</Text>
          <View style={x.line}><Text style={s.muted}>Выполнено заказов</Text><Text style={x.value}>{report.completionRate}%</Text></View>
          <View style={x.line}><Text style={s.muted}>Отменено</Text><Text style={x.value}>{report.cancelled}</Text></View>
          <View style={x.line}><Text style={s.muted}>Сотрудников в команде</Text><Text style={x.value}>{employees}</Text></View>
        </Card>
        {!filtered.length ? <EmptyState title="За выбранный период данных нет" body="Когда появятся заказы, отчёт сформируется автоматически." /> : null}
      </>}
    </Screen>
  );
}

const x = StyleSheet.create({
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { flexGrow: 1, flexBasis: 140, minWidth: 130, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0EEE9', borderRadius: 18, padding: 16, gap: 4 },
  metric: { fontSize: 25, fontWeight: '900', color: '#087562' },
  metricLabel: { color: '#69817B', fontSize: 13 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 5 },
  value: { flexShrink: 0, fontWeight: '900', color: '#173F37' },
});
