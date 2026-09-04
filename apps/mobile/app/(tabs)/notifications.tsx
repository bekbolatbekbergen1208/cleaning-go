import { Card, EmptyState, Screen, Title, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

type NotificationItem = { id: string; title: string; body: string; created_at: string };

export default function Notifications() {
  const profile = useSessionStore((state) => state.profile);
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    void supabase.from('notifications').select('id,title,body,created_at').order('created_at', { ascending: false }).then(({ data }) => setItems(data ?? []));
    const channel = supabase.channel('my-notifications').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => setItems((current) => [payload.new as NotificationItem, ...current])).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id, profile?.role]);

  return (
    <Screen>
      <Title subtitle="Заказы, статусы и назначения">Уведомления</Title>
      {items.length ? items.map((item) => <Card key={item.id}><Text style={s.cardTitle}>{item.title}</Text><Text>{item.body}</Text><Text style={s.muted}>{new Date(item.created_at).toLocaleString('ru-KZ')}</Text></Card>) : <EmptyState title="Всё спокойно" body="Новые заказы, статусы и начисления появятся здесь." />}
    </Screen>
  );
}
