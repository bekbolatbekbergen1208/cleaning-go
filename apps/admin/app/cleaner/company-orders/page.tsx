import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';
import { advanceCompanyOrder, claimCompanyOrder } from './actions';
import { CompletionForm } from './completion-form';

const statusLabels: Record<string, string> = { accepted: 'Принят', on_the_way: 'В пути', arrived: 'На месте', in_progress: 'Уборка идёт', completed_by_cleaner: 'Ожидает подтверждения клиента' };
const actionLabels: Record<string, string> = { accepted: 'Выехать к клиенту', on_the_way: 'Я на месте', arrived: 'Начать уборку' };
const clientMessages: Record<string, string> = {
  accepted: 'Здравствуйте! Я назначен на ваш заказ и скоро выеду.',
  on_the_way: 'Здравствуйте! Я уже выехал к вам.',
  arrived: 'Здравствуйте! Я приехал и нахожусь на месте.',
  in_progress: 'Здравствуйте! Я начал уборку.',
  completed_by_cleaner: 'Здравствуйте! Уборка завершена. Пожалуйста, проверьте результат.',
};

function contactPhone(phone?: string) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

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
  const { data: orders, error } = await admin.from('orders').select('id,order_number,status,address_text,city,scheduled_at,area_sq_m,rooms_count,total_minor,executor_amount_minor,required_workers,profiles!orders_client_id_fkey(full_name,phone)').eq('selected_company_id', membership.company_id).in('status', ['accepted', 'on_the_way', 'arrived', 'in_progress', 'completed_by_cleaner']).order('scheduled_at');
  const orderIds = (orders ?? []).map(item => item.id);
  const { data: workers } = orderIds.length ? await admin.from('order_workers').select('order_id,cleaner_id').in('order_id', orderIds) : { data: [] };
  const companyName = (membership.company_profiles as unknown as { name?: string } | null)?.name ?? 'Компания';

  return <div className="mx-auto max-w-4xl px-4 py-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">{companyName}</p><h1 className="text-3xl font-black">Заказы компании</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/profile">← Профиль</Link></div>{error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map(order => { const joined=(workers??[]).filter(worker=>worker.order_id===order.id); const alreadyJoined=joined.some(worker=>worker.cleaner_id===user.id); const available=joined.length<Number(order.required_workers); const client=order.profiles as unknown as {full_name?:string;phone?:string}|null; const phone=contactPhone(client?.phone); const message=`${clientMessages[order.status] ?? 'Здравствуйте! Пишу по вашему заказу.'} Заказ ${order.order_number}, Cleaning Go.`; return <article className="card" key={order.id}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{order.city}, {order.address_text}</p><p className="mt-2 text-sm font-bold text-blue-700">{statusLabels[order.status] ?? order.status}</p></div><b className="text-emerald-700">Заработок: {(Number(order.executor_amount_minor)/Math.max(1,Number(order.required_workers))/100).toLocaleString('ru-RU')} ₸</b></div><div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p>{order.area_sq_m} м² · {order.rooms_count} комн.</p><p>Нужно сотрудников: {order.required_workers}</p><p>Мест занято: {joined.length}/{order.required_workers}</p></div>{alreadyJoined ? <div className="mt-4"><p className="rounded-xl bg-emerald-50 p-3 text-center font-bold text-emerald-700">Вы назначены на этот заказ</p>{phone&&<div className="mt-3 grid grid-cols-2 gap-2"><a className="rounded-xl bg-green-600 px-4 py-3 text-center font-bold text-white" href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp клиенту</a><a className="rounded-xl bg-sky-600 px-4 py-3 text-center font-bold text-white" href={`tel:+${phone}`}>Позвонить</a></div>}{actionLabels[order.status] && <form action={advanceCompanyOrder} className="mt-3"><input type="hidden" name="order_id" value={order.id}/><button className="button w-full">{actionLabels[order.status]}</button></form>}{order.status === 'in_progress' && <CompletionForm orderId={order.id}/>} {order.status === 'completed_by_cleaner' && <p className="mt-3 text-center text-sm font-bold text-amber-700">Ожидаем, когда клиент подтвердит завершение</p>}</div> : order.status === 'accepted' && available ? <form action={claimCompanyOrder} className="mt-4"><input type="hidden" name="order_id" value={order.id}/><button className="button w-full">Взять заказ</button></form> : <p className="mt-4 text-center text-sm font-bold text-slate-500">Команда уже набрана</p>}</article>})}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Свободных заказов пока нет</p><p className="mt-2 text-sm text-slate-500">После публикации компанией новые заказы появятся здесь.</p></div>}</div>;
}
