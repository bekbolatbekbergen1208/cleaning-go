import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { LiveOrderUpdates } from '../../../components/live-order-updates';
import { confirmOrderCompletion } from '../actions';
import { ConfirmPriceForm } from '../confirm-price-form';
import { CancelOrderButton } from '../cancel-order-button';

const names: Record<string, string> = { searching: 'Ожидает исполнителя', offered: 'Цена предложена', accepted: 'Принят', on_the_way: 'В пути', arrived: 'На месте', in_progress: 'Уборка идёт', completed_by_cleaner: 'Ожидает подтверждения', completed: 'Завершён', cancelled: 'Отменён', disputed: 'Спор' };

export default async function ClientOrdersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role,status').eq('id', user.id).single();
  if (profile?.role !== 'client' || profile.status !== 'active') redirect('/profile');
  const { data: orders, error } = await supabase.from('orders').select('id,order_number,status,city,address_text,scheduled_at,total_minor,price_confirmed_at,reviews(id)').eq('client_id', user.id).order('created_at', { ascending: false });
  return <div className="mx-auto max-w-3xl px-4 py-10"><LiveOrderUpdates userId={user.id}/><Link href="/profile" className="text-sm font-bold text-emerald-700">← Профиль</Link><h1 className="mt-4 text-3xl font-black">Все мои заказы</h1>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map(order => <article className="card" key={order.id}>
      <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-black">Заказ {order.order_number}</h2><span className="font-bold text-emerald-700">{names[order.status] ?? order.status}</span></div>
      <p className="mt-2 text-sm text-slate-600">{order.city}, {order.address_text}</p><p className="mt-1 text-sm">{new Date(order.scheduled_at).toLocaleString('ru-KZ')} · {(Number(order.total_minor) / 100).toLocaleString('ru-RU')} ₸</p>
      {['accepted','on_the_way','arrived','in_progress'].includes(order.status) && <Link href={`/order/${order.id}/tracking`} className="mt-3 inline-block text-sm font-bold text-blue-700">Карта заказа →</Link>}
      {order.status === 'offered' && !order.price_confirmed_at && <ConfirmPriceForm orderId={order.id}/>}
      {['created','searching','offered'].includes(order.status) && !order.price_confirmed_at && <CancelOrderButton orderId={order.id}/>}
      {order.status === 'completed_by_cleaner' && <form action={confirmOrderCompletion} className="mt-3"><input type="hidden" name="order_id" value={order.id}/><button className="button w-full">Подтвердить завершение</button></form>}
      {order.status === 'completed' && !order.reviews?.length && <Link href={`/order/${order.id}/review`} className="mt-3 inline-block text-sm font-bold text-emerald-700">Оценить уборку →</Link>}
    </article>)}</div> : <p className="card mt-6">Заказов пока нет. <Link href="/order/new" className="font-bold text-emerald-700">Создать заказ →</Link></p>}
  </div>;
}
