import { redirect } from 'next/navigation';
import { createClient } from '../../lib/backend/server';
import { NotificationFeed } from './notification-feed';

export default async function NotificationsPage() {
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();
  if (!user) redirect('/login');
  return <div className="mx-auto max-w-2xl px-4 py-10"><h1 className="text-3xl font-black">Уведомления</h1><p className="mt-2 text-sm text-slate-500">Заказы, статусы и назначения обновляются автоматически.</p><NotificationFeed userId={user.id} /></div>;
}
