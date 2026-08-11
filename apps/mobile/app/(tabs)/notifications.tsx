import { Card, EmptyState, Screen, Title, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

type NotificationItem = { id: string; title: string; body: string; created_at: string };
type Employee = { cleaner_id: string; is_active: boolean; profiles: { full_name: string } | { full_name: string }[] | null };

export default function Notifications() {
  const profile = useSessionStore((state) => state.profile);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    if (profile?.role === 'company_owner') {
      void supabase.from('company_profiles').select('id,employee_limit').eq('owner_id', profile.id).single().then(async ({ data }) => {
        if (!data) return;
        const { data: team } = await supabase.from('company_cleaners').select('cleaner_id,is_active,profiles!cleaner_id(full_name)').eq('company_id', data.id).eq('is_active', true);
        setEmployees((team ?? []) as Employee[]);
      });
      return;
    }
    void supabase.from('notifications').select('id,title,body,created_at').order('created_at', { ascending: false }).then(({ data }) => setItems(data ?? []));
    const channel = supabase.channel('my-notifications').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => setItems((current) => [payload.new as NotificationItem, ...current])).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id, profile?.role]);

  if (profile?.role === 'company_owner') {
    return (
      <Screen>
        <Title subtitle={`В команде ${employees.length} сотрудников`}>Сотрудники</Title>
        <Card>
          <Text style={s.cardTitle}>Код для подключения сотрудников</Text>
          <Text style={s.muted}>Сотрудник регистрируется как клинер и вводит специальный код вашей компании. Количество сотрудников для выполнения компания задаёт отдельно в каждом заказе.</Text>
        </Card>
        {employees.length ? employees.map((employee) => {
          const joined = Array.isArray(employee.profiles) ? employee.profiles[0] : employee.profiles;
          return <Card key={employee.cleaner_id}><Text style={s.cardTitle}>{joined?.full_name ?? 'Сотрудник'}</Text><Text style={s.muted}>Активный сотрудник</Text></Card>;
        }) : <EmptyState title="Сотрудников пока нет" body="Передайте код компании клинерам, чтобы они присоединились к команде." />}
      </Screen>
    );
  }

  return (
    <Screen>
      <Title subtitle="Здесь появятся новые заказы компании">Уведомления</Title>
      {items.length ? items.map((item) => <Card key={item.id}><Text style={s.cardTitle}>{item.title}</Text><Text>{item.body}</Text><Text style={s.muted}>{new Date(item.created_at).toLocaleString('ru-KZ')}</Text></Card>) : <EmptyState title="Всё спокойно" body="Новые заказы, статусы и начисления появятся здесь." />}
    </Screen>
  );
}
