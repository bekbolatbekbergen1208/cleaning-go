import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';
import { claimCompanyOrder } from './actions';

export default async function CleanerCompanyOrders() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  // The cleaner is authenticated first, then the server reads only that
  // cleaner's active company. This avoids an RLS + inner-join combination that
  // hid valid published orders even though their assignment was still free.
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: membership } = await admin.from('company_cleaners').select('company_id,company_profiles(name)').eq('cleaner_id', user.id).eq('is_active', true).maybeSingle();
  if (!membership) redirect('/profile');
  const { data: freeAssignments, error: assignmentError } = await admin.from('order_assignments').select('order_id').eq('company_id', membership.company_id).eq('is_active', true).is('cleaner_id', null);
  const orderIds = (freeAssignments ?? []).map(item => item.order_id);
  const { data: orders, error: ordersError } = orderIds.length
    ? await admin.from('orders').select('id,order_number,address_text,city,scheduled_at,area_sq_m,rooms_count,total_minor,executor_amount_minor,required_workers').eq('selected_company_id', membership.company_id).eq('status', 'accepted').in('id', orderIds).order('scheduled_at')
    : { data: [], error: null };
  const error = assignmentError ?? ordersError;
  const { data: workers } = orderIds.length ? await admin.from('order_workers').select('order_id,cleaner_id').in('order_id', orderIds) : { data: [] };
  const companyName = (membership.company_profiles as unknown as { name?: string } | null)?.name ?? 'Компания';

  return <div className="mx-auto max-w-4xl px-4 py-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">{companyName}</p><h1 className="text-3xl font-black">Заказы компании</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/profile">← Профиль</Link></div>{error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map(order => { const joined=(workers??[]).filter(worker=>worker.order_id===order.id); const alreadyJoined=joined.some(worker=>worker.cleaner_id===user.id); const available=joined.length<Number(order.required_workers); return <article className="card" key={order.id}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{order.city}, {order.address_text}</p></div><b className="text-emerald-700">Заработок: {(Number(order.executor_amount_minor)/Math.max(1,Number(order.required_workers))/100).toLocaleString('ru-RU')} ₸</b></div><div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p>{order.area_sq_m} м² · {order.rooms_count} комн.</p><p>Нужно сотрудников: {order.required_workers}</p><p>Мест занято: {joined.length}/{order.required_workers}</p></div>{alreadyJoined?<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-center font-bold text-emerald-700">Вы назначены на этот заказ</p>:available?<form action={claimCompanyOrder} className="mt-4"><input type="hidden" name="order_id" value={order.id}/><button className="button w-full">Взять заказ</button></form>:<p className="mt-4 text-center text-sm font-bold text-slate-500">Команда уже набрана</p>}</article>})}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Свободных заказов пока нет</p><p className="mt-2 text-sm text-slate-500">После публикации компанией новые заказы появятся здесь.</p></div>}</div>;
}
