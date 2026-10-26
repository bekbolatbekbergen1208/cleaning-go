import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';
import { acceptDirectOrder, advanceDirectOrder } from './actions';
import { LiveOrderUpdates } from '../../../components/live-order-updates';

const statusNames: Record<string, string> = { searching: 'Ждёт вашего ответа', accepted: 'Принят', on_the_way: 'В пути', arrived: 'На месте', in_progress: 'Уборка идёт', completed_by_cleaner: 'Ожидает подтверждения клиента', completed: 'Завершён', cancelled: 'Отменён' };
const actionNames: Record<string, string> = { accepted: 'Начать маршрут', on_the_way: 'Я на месте', arrived: 'Начать уборку', in_progress: 'Уборка завершена' };

export default async function DirectOrdersPage() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect('/login');
  const db = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: cleaner }, { data: orders, error }] = await Promise.all([
    db.from('profiles').select('role,status').eq('id', user.id).single(),
    db.from('cleaner_profiles').select('verification_status,is_available').eq('user_id', user.id).maybeSingle(),
    db.from('orders').select('id,order_number,status,city,address_text,scheduled_at,area_sq_m,rooms_count,total_minor').eq('selected_cleaner_id', user.id).order('created_at', { ascending: false }).limit(100),
  ]);
  if (profile?.role !== 'cleaner' || profile.status !== 'active' || cleaner?.verification_status !== 'approved') redirect('/profile');
  return <div className="mx-auto max-w-4xl px-4 py-10"><LiveOrderUpdates cleanerId={user.id}/><Link href="/profile" className="text-sm font-bold text-emerald-700">← Профиль</Link><h1 className="mt-4 text-3xl font-black">Заказы напрямую вам</h1><p className="mt-2 text-sm text-slate-500">Клиенты выбрали вас как исполнителя. Новые заказы можно принять здесь.</p>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map(order => <article className="card" key={order.id}>
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-600">{order.city}, {order.address_text}</p></div><span className="font-bold text-emerald-700">{statusNames[order.status] ?? order.status}</span></div>
      <p className="mt-3 text-sm">{new Date(order.scheduled_at).toLocaleString('ru-KZ')} · {order.area_sq_m} м² · {order.rooms_count} комн. · {(Number(order.total_minor) / 100).toLocaleString('ru-RU')} ₸</p>
      {order.status === 'searching' && <form action={acceptDirectOrder} className="mt-4"><input type="hidden" name="order_id" value={order.id}/><button className="button w-full" disabled={!cleaner.is_available}>Принять заказ</button></form>}
      {actionNames[order.status] && <form action={advanceDirectOrder} className="mt-4"><input type="hidden" name="order_id" value={order.id}/><input type="hidden" name="status" value={order.status}/><button className="button w-full">{actionNames[order.status]}</button></form>}
      {['accepted','on_the_way','arrived','in_progress'].includes(order.status) && <Link href={`/order/${order.id}/tracking`} className="mt-3 inline-block text-sm font-bold text-blue-700">Местоположение и карта →</Link>}
    </article>)}</div> : <p className="card mt-6">Прямых заказов пока нет.</p>}
  </div>;
}
