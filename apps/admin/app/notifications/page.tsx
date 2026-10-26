import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { NotificationFeed } from './notification-feed';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return <div className="mx-auto max-w-2xl px-4 py-10"><h1 className="text-3xl font-black">Уведомления</h1><p className="mt-2 text-sm text-slate-500">Заказы, статусы и назначения обновляются автоматически.</p><NotificationFeed userId={user.id} /></div>;
}
