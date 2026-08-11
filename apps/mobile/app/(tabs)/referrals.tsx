import { Button, Card, Screen, Title, formatMoney, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useEffect, useState } from 'react';
import { Alert, Platform, Share, Text } from 'react-native';

export default function Referrals() {
  const profile = useSessionStore((state) => state.profile);
  const [balance, setBalance] = useState(0);
  const [copied, setCopied] = useState(false);
  const code = profile?.referral_code ?? '';
  const link = `https://cleaninggo.kz/r/${code}`;

  useEffect(() => {
    if (!profile?.id) return;
    void supabase.from('wallets').select('available_minor').eq('owner_id', profile.id).single().then(({ data }) => setBalance(data?.available_minor ?? 0));
  }, [profile?.id]);

  async function shareLink() {
    if (!code) {
      Alert.alert('Код ещё не создан', 'Обновите страницу через несколько секунд.');
      return;
    }
    const message = `Закажите уборку в Cleaning Go по моей ссылке: ${link}`;
    try {
      if (Platform.OS === 'web') {
        if (!navigator.clipboard) throw new Error('Clipboard is unavailable');
        await navigator.clipboard.writeText(message);
        setCopied(true);
        return;
      }
      await Share.share({ message, url: link, title: 'Приглашение в Cleaning Go' });
    } catch {
      Alert.alert('Не удалось поделиться', `Скопируйте ссылку вручную: ${link}`);
    }
  }

  return (
    <Screen>
      <Title subtitle="Получайте процент с первого завершённого заказа друга">Приглашайте — зарабатывайте</Title>
      <Card>
        <Text style={s.muted}>Доступный баланс</Text>
        <Text style={{ fontSize: 32, fontWeight: '800' }}>{formatMoney(balance)}</Text>
      </Card>
      <Card>
        <Text style={s.muted}>Ваш код</Text>
        <Text style={s.cardTitle}>{code || 'Создаётся…'}</Text>
        <Text selectable>{link}</Text>
        <Button title={copied ? 'Ссылка скопирована ✓' : Platform.OS === 'web' ? 'Скопировать ссылку' : 'Поделиться ссылкой'} onPress={() => void shareLink()} disabled={!code} />
      </Card>
      <Text style={s.muted}>5% начисляются один раз после первого оплаченного и подтверждённого заказа приглашённого клиента. Процент может меняться администратором.</Text>
    </Screen>
  );
}
