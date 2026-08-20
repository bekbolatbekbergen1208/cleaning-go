import { createClient as createAdminClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';

const statusNames: Record<string, string> = {
  searching: 'Ожидает компании',
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
    .select('id,order_number,status,address_text,city,scheduled_at,area_sq_m,rooms_count,total_minor,created_at,profiles!orders_client_id_fkey(full_name,phone)')
    .eq('selected_company_id', company.id)
    .order('created_at', { ascending: false });

  return <div className="mx-auto max-w-5xl px-4 py-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">{company.name}</p><h1 className="text-3xl font-black">Заказы компании</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/company">← Кабинет</Link></div>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map((order) => {
      const client = order.profiles as unknown as { full_name?: string; phone?: string } | null;
      return <article className="card" key={order.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{client?.full_name ?? 'Клиент'} · {client?.phone ?? 'телефон не указан'}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">{statusNames[order.status] ?? order.status}</span></div><div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p><b>Адрес:</b> {order.city}, {order.address_text}</p><p><b>Дата:</b> {new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p><b>Помещение:</b> {order.area_sq_m} м², {order.rooms_count} комн.</p><p><b>Сумма:</b> {(Number(order.total_minor) / 100).toLocaleString('ru-RU')} ₸</p></div></article>;
    })}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Заказов пока нет</p><p className="mt-2 text-sm text-slate-500">Новые заказы, отправленные вашей компании, появятся здесь.</p></div>}
  </div>;
}
