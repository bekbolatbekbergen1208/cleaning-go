import { Button, Card, EmptyState, Field, Screen, Title, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

type Company = {
  id: string;
  name: string;
  description: string | null;
  service_cities: string[];
  rating: number;
  reviews_count: number;
  cashback_bps: number;
  welcome_bonus_minor: number;
};

export default function SelectCompany() {
  const router = useRouter();
  const profileId = useSessionStore((state) => state.profile?.id);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [promoCode, setPromoCode] = useState('');

  useEffect(() => {
    if (!profileId) return;
    void supabase.from('client_profiles').select('company_locked').eq('user_id', profileId).single().then(({ data }) => {
      if (data?.company_locked) {
        Alert.alert('Компания уже закреплена', 'Вы зарегистрировались по специальному коду и не можете выбирать другие компании.');
        router.replace('/(tabs)');
        return;
      }
      void supabase
      .from('company_profiles')
      .select('id,name,description,service_cities,rating,reviews_count,cashback_bps,welcome_bonus_minor')
      .eq('verification_status', 'approved')
      .order('rating', { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) Alert.alert('Не удалось загрузить компании', error.message);
        setCompanies((data ?? []) as Company[]);
      });
    });
  }, [profileId, router]);

  async function confirm() {
    if (!selected) return Alert.alert('Выберите компанию', 'Нажмите на карточку подходящей компании.');
    setBusy(true);
    const { error } = await supabase.rpc('choose_company', { target_company_id: selected });
    setBusy(false);
    if (error) return Alert.alert('Не удалось выбрать компанию', error.message);
    Alert.alert('Компания выбрана', 'Все ваши заказы будут направляться этой компании.');
    router.replace('/create-order');
  }

  async function applyPromoCode() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return Alert.alert('Введите промокод');
    setBusy(true);
    const { data, error } = await supabase.rpc('apply_company_promo_code', { input_code: code });
    setBusy(false);
    if (error) return Alert.alert('Промокод не принят', error.message);
    const company = data as Company;
    Alert.alert('Промокод активирован', `Вы закреплены за «${company.name}». Начислено ${company.welcome_bonus_minor / 100} ₸, которые можно потратить только в этой компании.`);
    router.replace('/create-order');
  }

  return (
    <Screen>
      <Title subtitle="Рейтинг рассчитан по отзывам клиентов">Выберите клининговую компанию</Title>
      <Text style={s.muted}>Вы сможете оформить заказ после выбора компании.</Text>
      <Card>
        <Text style={s.cardTitle}>Есть промокод компании?</Text>
        <Text style={s.muted}>Введите его, чтобы закрепиться за компанией и получать её бонус после заказов.</Text>
        <Field label="Промокод" value={promoCode} onChangeText={setPromoCode} placeholder="Например, CGC-A1B2C3D4" autoCapitalize="characters" />
        <Button title="Применить промокод" busy={busy} onPress={() => void applyPromoCode()} />
      </Card>
      {loading ? <Text style={s.muted}>Загружаем компании…</Text> : null}
      {!loading && !companies.length ? <EmptyState title="Пока нет доступных компаний" body="Проверенные компании появятся здесь после подтверждения администратором." /> : null}
      {companies.map((company) => (
        <Pressable key={company.id} onPress={() => setSelected(company.id)}>
          <Card>
            <View style={x.row}>
              <View style={x.copy}>
                <Text style={s.cardTitle}>{company.name}</Text>
                <Text style={s.muted}>{company.service_cities.join(', ') || 'Город не указан'}</Text>
              </View>
              <View style={x.rating}><Text style={x.ratingText}>★ {Number(company.rating).toFixed(1)}</Text></View>
            </View>
            {company.description ? <Text>{company.description}</Text> : null}
            <Text style={s.muted}>{company.reviews_count} отзывов</Text>
            <Text style={s.badge}>Кешбэк за каждый завершённый заказ: {company.cashback_bps / 100}%</Text>
            <Text style={s.badge}>Приветственный бонус: {company.welcome_bonus_minor / 100} ₸</Text>
            {selected === company.id ? <Text style={s.badge}>Выбрано</Text> : null}
          </Card>
        </Pressable>
      ))}
      <Button title="Подтвердить выбор" busy={busy} disabled={!selected} onPress={() => void confirm()} />
    </Screen>
  );
}

const x = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  copy: { flex: 1, gap: 3 },
  rating: { backgroundColor: '#FFF4CE', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  ratingText: { color: '#725B00', fontWeight: '900' },
});
