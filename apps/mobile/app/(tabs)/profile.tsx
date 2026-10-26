import { Button, Card, Screen, Title, s } from '@/components/ui';
import { stopOrderTracking } from '@/lib/background-location';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

const durations = [4, 6, 8, 10, 12];
export default function Profile() {
  const profile = useSessionStore(state => state.profile);
  const isCleaner = profile?.role === 'cleaner' || profile?.role === 'company_cleaner';
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [hours, setHours] = useState(8);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const active = available && Boolean(endsAt && Date.parse(endsAt) > now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isCleaner || !profile?.id) return;
    void supabase.from('cleaner_profiles').select('is_available,workday_ends_at').eq('user_id', profile.id).single()
      .then(({ data }) => { setAvailable(Boolean(data?.is_available)); setEndsAt(data?.workday_ends_at ?? null); });
  }, [isCleaner, profile?.id]);

  async function toggleShift() {
    setBusy(true);
    const { data, error } = await supabase.rpc('set_cleaner_workday', { target_active: !active, duration_hours: hours });
    if (error) Alert.alert('Не удалось изменить смену', error.message);
    else {
      if (active) await stopOrderTracking();
      setAvailable(Boolean(data));
      setEndsAt(active ? null : new Date(Date.now() + hours * 3_600_000).toISOString());
    }
    setBusy(false);
  }
  async function signOut() {
    await stopOrderTracking();
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Ошибка', error.message);
  }
  return <Screen><Title>Профиль</Title>
    <Card><Text style={s.cardTitle}>{profile?.full_name}</Text><Text>{profile?.email ?? profile?.phone}</Text><Text style={s.badge}>{profile?.role}</Text><Text style={s.muted}>{profile?.city ?? 'Город не указан'}</Text></Card>
    {isCleaner && <Card><Text style={s.cardTitle}>Рабочий день</Text>
      <Text style={s.muted}>{active ? `Вы доступны до ${new Date(endsAt!).toLocaleString('ru-KZ')}. Затем GPS станет недоступен автоматически.` : 'Смена завершена. Передача GPS недоступна.'}</Text>
      {!active && <View style={s.row}>{durations.map(value => <Button key={value} title={`${value} ч`} variant={hours === value ? 'primary' : 'secondary'} onPress={() => setHours(value)} />)}</View>}
      <Button title={busy ? 'Сохраняем…' : active ? 'Завершить рабочий день' : 'Начать рабочий день'} variant={active ? 'danger' : 'primary'} onPress={() => { if (!busy) void toggleShift(); }} />
    </Card>}
    <Button title="Выйти" variant="danger" onPress={() => void signOut()} />
  </Screen>;
}
