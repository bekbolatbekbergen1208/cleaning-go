import { createClient as createAdminClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { proposeCompanyPrice, publishCompanyOrder } from './actions';

const statusNames: Record<string, string> = {
  searching: 'Ожидает компании',
  offered: 'Цена предложена клиенту',
  awaiting_price: 'Ожидает цены',
  price_proposed: 'Цена предложена',
  accepted: 'Принят',
  on_the_way: 'В пути',
  arrived: 'На месте',
  in_progress: 'В работе',
  completed_by_cleaner: 'Ожидает завершения',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export default async function CompanyOrders() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: profile }, { data: company }] = await Promise.all([
    admin.from('profiles').select('role,status').eq('id', user.id).single(),
    admin.from('company_profiles').select('id,name').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner' || profile.status !== 'active' || !company) redirect('/login?error=company_account');

  const { data: orders, error } = await admin
    .from('orders')
    .select('id,order_number,status,address_text,city,scheduled_at,area_sq_m,rooms_count,total_minor,executor_amount_minor,required_workers,price_confirmed_at,created_at,profiles!orders_client_id_fkey(full_name,phone)')
    .eq('selected_company_id', company.id)
    .order('created_at', { ascending: false });

  return <div className="mx-auto max-w-5xl px-4 py-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">{company.name}</p><h1 className="text-3xl font-black">Заказы компании</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/company">← Кабинет</Link></div>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map((order) => {
      const client = order.profiles as unknown as { full_name?: string; phone?: string } | null;
      const waitingForClient = order.status === 'offered' && !order.price_confirmed_at;
      const clientConfirmed = order.status === 'offered' && Boolean(order.price_confirmed_at);
      return <article className="card" key={order.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{client?.full_name ?? 'Клиент'} · {client?.phone ?? 'телефон не указан'}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">{clientConfirmed ? 'Клиент подтвердил цену' : statusNames[order.status] ?? order.status}</span></div><div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p><b>Адрес:</b> {order.city}, {order.address_text}</p><p><b>Дата:</b> {new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p><b>Помещение:</b> {order.area_sq_m} м², {order.rooms_count} комн.</p><p><b>Сумма:</b> {(Number(order.total_minor) / 100).toLocaleString('ru-RU')} ₸</p></div>{order.status === 'searching' ? <form action={proposeCompanyPrice} className="mt-5 flex flex-col gap-3 rounded-2xl bg-emerald-50 p-4 sm:flex-row sm:items-end"><input type="hidden" name="order_id" value={order.id}/><label className="flex-1 text-sm font-bold text-emerald-900">Предложить цену клиенту, ₸<input className="input mt-1 bg-white" name="total_kzt" type="number" min="100" step="1" required/></label><button className="button sm:min-w-64">Отправить цену клиенту</button></form> : waitingForClient ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">Ожидаем подтверждения цены клиентом</p> : clientConfirmed ? <form action={publishCompanyOrder} className="mt-5 grid gap-3 rounded-2xl bg-emerald-50 p-4 sm:grid-cols-2"><input type="hidden" name="order_id" value={order.id}/><label className="text-sm font-bold text-emerald-900">Количество сотрудников<input className="input mt-1 bg-white" name="required_workers" type="number" min="1" max="50" defaultValue="1" required/></label><label className="text-sm font-bold text-emerald-900">Общая выплата клинерам, ₸<input className="input mt-1 bg-white" name="cleaner_amount_kzt" type="number" min="0" max={Number(order.total_minor)/100} required/></label><button className="button sm:col-span-2">Опубликовать клинерам</button></form> : order.status === 'accepted' ? <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-700"><p>Заказ опубликован для клинеров компании</p><p className="mt-1">Нужно сотрудников: {order.required_workers} · Выплата клинерам: {(Number(order.executor_amount_minor)/100).toLocaleString('ru-RU')} ₸</p></div> : null}</article>;
    })}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Заказов пока нет</p><p className="mt-2 text-sm text-slate-500">Новые заказы, отправленные вашей компании, появятся здесь.</p></div>}
  </div>;
}
