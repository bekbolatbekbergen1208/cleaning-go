import { Button, Card, EmptyState, Screen, Title, formatMoney, s } from '@/components/ui';
import { demoServices } from '@/lib/demo';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import type { CleaningService } from '@cleaning-go/types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

type ClientCompany = { id: string; name: string; rating: number; reviews_count: number; cashback_bps: number };
type CompanyReport = {
  company_code: string;
  verification_status: string;
  clients: number;
  orders_total: number;
  orders_active: number;
  orders_completed: number;
  revenue_minor: number;
  rating: number;
  reviews_count: number;
  cashback_bps: number;
  cashback_paid_minor: number;
};

const emptyReport: CompanyReport = { company_code: '', verification_status: 'pending', clients: 0, orders_total: 0, orders_active: 0, orders_completed: 0, revenue_minor: 0, rating: 0, reviews_count: 0, cashback_bps: 500, cashback_paid_minor: 0 };

export default function Home() {
  const profile = useSessionStore((state) => state.profile);
  const demoOrders = useSessionStore((state) => state.demoOrders);
  const router = useRouter();
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const [services, setServices] = useState<CleaningService[]>(demo ? demoServices : []);
  const [companyCode, setCompanyCode] = useState(demo ? 'CGC-DEMO25' : '');
  const [clientCompany, setClientCompany] = useState<ClientCompany | null>(null);
  const [companyLocked, setCompanyLocked] = useState(false);
  const [stats, setStats] = useState({ active: 0, total: 0 });
  const [report, setReport] = useState<CompanyReport>(emptyReport);
  const [welcomeBonusMinor, setWelcomeBonusMinor] = useState(200000);

  useFocusEffect(useCallback(() => {
    if (demo) {
      setServices(demoServices);
      setStats({ total: demoOrders.length, active: demoOrders.filter((order) => !['completed', 'cancelled'].includes(order.status)).length });
      if (profile?.role === 'client') setClientCompany({ id: 'demo-company', name: 'Cleaning Go Demo', rating: 4.9, reviews_count: 128, cashback_bps: 500 });
      if (profile?.role === 'company_owner') setReport({ ...emptyReport, clients: 24, orders_total: demoOrders.length, orders_active: stats.active, rating: 4.9, reviews_count: 128 });
      return;
    }

    void supabase.from('cleaning_services').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setServices((data ?? []) as CleaningService[]));
    void supabase.from('orders').select('id,status').then(({ data }) => setStats({ total: data?.length ?? 0, active: data?.filter((order) => !['completed', 'cancelled'].includes(order.status)).length ?? 0 }));

    if (profile?.role === 'company_owner') {
      void supabase.from('company_profiles').select('company_code,welcome_bonus_minor').eq('owner_id', profile.id).single().then(({ data }) => {if(data?.company_code)setCompanyCode(data.company_code);setWelcomeBonusMinor(Number(data?.welcome_bonus_minor??200000));});
      void supabase.rpc('get_my_company_report').then(({ data }) => {
        if (!data) return;
        const nextReport = data as CompanyReport;
        setReport(nextReport);
        if (nextReport.company_code) setCompanyCode(nextReport.company_code);
      });
    }
    if (profile?.role === 'client') {
      void supabase
        .from('client_profiles')
        .select('preferred_company_id,company_locked,company_profiles!preferred_company_id(id,name,rating,reviews_count,cashback_bps)')
        .eq('user_id', profile.id)
        .single()
        .then(({ data, error }) => {
          if (error) {
            Alert.alert('Не удалось загрузить вашу компанию', error.message);
            return;
          }
          const joined = data?.company_profiles;
          setClientCompany(((Array.isArray(joined) ? joined[0] : joined) as ClientCompany | null) ?? null);
          setCompanyLocked(Boolean(data?.company_locked));
        });
    }
  }, [demo, demoOrders, profile?.id, profile?.role]));

  if (!profile) return null;

  async function updateCashback(bps: number) {
    const { error } = await supabase.rpc('set_my_company_cashback', { target_bps: bps });
    if (error) return Alert.alert('Не удалось изменить кешбэк', error.message);
    setReport((current) => ({ ...current, cashback_bps: bps }));
    Alert.alert('Кешбэк сохранён', `Клиенты по вашему коду будут получать ${bps / 100}% после завершённого заказа.`);
  }

  async function updateWelcomeBonus(minor: number) {
    const { error } = await supabase.rpc('set_my_company_welcome_bonus', { target_minor: minor });
    if (error) return Alert.alert('Не удалось изменить бонус', error.message);
    setWelcomeBonusMinor(minor);
    Alert.alert('Бонус сохранён', `Новые клиенты получат ${minor / 100} ₸ для заказов только у вашей компании.`);
  }

  if (profile.role === 'cleaner' || profile.role === 'company_cleaner') {
    return (
      <Screen>
        <Title subtitle="Управляйте доступностью и текущей работой">Добрый день, {profile.full_name}</Title>
        <Card><Text style={s.cardTitle}>Сегодня</Text><Text>Активных заказов: {stats.active}</Text><Button title="Открыть доступные заказы" onPress={() => router.push('/(tabs)/orders')} /></Card>
      </Screen>
    );
  }

  if (profile.role === 'company_owner') {
    return (
      <Screen>
        <Title subtitle="Отчёт обновляется автоматически по вашим клиентам и заказам">Панель компании</Title>
        <Card>
          <Text style={s.muted}>Промокод вашей компании</Text>
          <Text style={x.companyCode}>{companyCode || 'Не удалось загрузить код'}</Text>
          <Text style={s.muted}>{report.verification_status === 'approved' ? 'Компания подтверждена' : 'Ожидает подтверждения администратора'}</Text>
          <Text style={s.muted}>Передайте промокод клиентам. Они закрепятся за вашей компанией и получат бонус {report.cashback_bps / 100}% после каждого завершённого заказа.</Text>
        </Card>
        <Text style={x.sectionTitle}>Автоматический отчёт</Text>
        <Card>
          <Text style={s.cardTitle}>Кешбэк клиентам по коду: {report.cashback_bps / 100}%</Text>
          <Text style={s.muted}>Компания начисляет его автоматически после завершения заказа.</Text>
          <View style={s.row}>
            {[300, 500, 1000].map((bps) => <Button key={bps} title={`${bps / 100}%`} variant={report.cashback_bps === bps ? 'primary' : 'secondary'} onPress={() => void updateCashback(bps)} />)}
          </View>
          <Text style={s.muted}>Всего начислено: {formatMoney(report.cashback_paid_minor)}</Text>
        </Card>
        <Card>
          <Text style={s.cardTitle}>Приветственный бонус: {formatMoney(welcomeBonusMinor)}</Text>
          <Text style={s.muted}>Выдаётся один раз при выборе компании и работает только на ваши заказы.</Text>
          <View style={s.row}>{[100000,200000,300000].map((minor)=><Button key={minor} title={`${minor/100} ₸`} variant={welcomeBonusMinor===minor?'primary':'secondary'} onPress={()=>void updateWelcomeBonus(minor)}/>)}</View>
        </Card>
        <View style={x.reportGrid}>
          <Card><Text style={x.metric}>{report.clients}</Text><Text style={s.muted}>Ваших клиентов</Text></Card>
          <Card><Text style={x.metric}>{report.orders_active}</Text><Text style={s.muted}>Активных заказов</Text></Card>
          <Card><Text style={x.metric}>{report.orders_completed}</Text><Text style={s.muted}>Завершено</Text></Card>
          <Card><Text style={x.metric}>{formatMoney(report.revenue_minor)}</Text><Text style={s.muted}>Выручка</Text></Card>
        </View>
        <Card>
          <Text style={s.cardTitle}>★ {Number(report.rating).toFixed(1)}</Text>
          <Text style={s.muted}>{report.reviews_count} отзывов · {report.orders_total} заказов всего</Text>
        </Card>
        <Button title="Управлять заказами" onPress={() => router.push('/(tabs)/orders')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title subtitle="Выберите услугу и удобное время">Чем помочь сегодня?</Title>
      {clientCompany ? (
        <Card>
          <Text style={s.muted}>Ваша клининговая компания</Text>
          <Text style={s.cardTitle}>{clientCompany.name}</Text>
          <Text>★ {Number(clientCompany.rating).toFixed(1)} · {clientCompany.reviews_count} отзывов</Text>
          {companyLocked ? <Text style={x.cashback}>Кешбэк компании: {clientCompany.cashback_bps / 100}% с каждого завершённого заказа</Text> : null}
          {companyLocked
            ? <Text style={s.muted}>Компания закреплена специальным кодом. Выбор других компаний недоступен.</Text>
            : <Button title="Сменить компанию" variant="secondary" onPress={() => router.push('/select-company')} />}
        </Card>
      ) : (
        <Card>
          <Text style={s.cardTitle}>Выберите компанию</Text>
          <Text style={s.muted}>У вас не было кода компании. Посмотрите рейтинг и выберите подходящую компанию.</Text>
        </Card>
      )}
      <Button title={clientCompany ? 'Заказать уборку' : 'Выбрать компанию для заказа'} onPress={() => router.push(clientCompany ? '/create-order' : '/select-company')} />
      {services.length ? services.map((service) => <Card key={service.id}><Text style={s.cardTitle}>{service.name}</Text><Text style={s.muted}>{service.description}</Text><Text style={s.muted}>Цену рассчитает ваша клининговая компания</Text></Card>) : <EmptyState title="Каталог загружается" body="Услуги появятся после подключения к базе." />}
    </Screen>
  );
}

const x = StyleSheet.create({
  companyCode: { fontSize: 28, fontWeight: '900', color: '#087562', letterSpacing: 1 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#173F37', marginTop: 4 },
  reportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { fontSize: 22, fontWeight: '900', color: '#087562' },
  cashback: { backgroundColor: '#FFF4CE', color: '#725B00', fontWeight: '800', padding: 12, borderRadius: 12, overflow: 'hidden' },
});
