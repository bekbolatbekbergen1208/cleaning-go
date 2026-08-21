import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

const statusLabels: Record<string, string> = {
  accepted: 'Принят', on_the_way: 'В пути', arrived: 'На месте', in_progress: 'Уборка идёт',
  completed_by_cleaner: 'Ожидает подтверждения клиента', completed: 'Завершён', cancelled: 'Отменён',
};

export default async function CleanerMyWorkPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  if (!profile || !['cleaner', 'company_cleaner'].includes(profile.role) || profile.status !== 'active') redirect('/profile');
  const { data: assignments, error: assignmentError } = await admin.from('order_workers').select('order_id,created_at').eq('cleaner_id', user.id).order('created_at', { ascending: false });
  const orderIds = (assignments ?? []).map(item => item.order_id);
  const { data: orders, error: ordersError } = orderIds.length
    ? await admin.from('orders').select('id,order_number,status,address_text,city,scheduled_at,area_sq_m,rooms_count,executor_amount_minor,required_workers,company_profiles!selected_company_id(name)').in('id', orderIds).order('scheduled_at', { ascending: false })
    : { data: [], error: null };

  return <div className="mx-auto max-w-4xl px-4 py-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">Кабинет клинера</p><h1 className="text-3xl font-black">Моя работа</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/profile">← Профиль</Link></div>
    {assignmentError || ordersError ? <p className="card mt-6 text-red-600">Не удалось загрузить ваши заказы.</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map(order => {
      const company = order.company_profiles as unknown as { name?: string } | null;
      const earning = Number(order.executor_amount_minor) / Math.max(1, Number(order.required_workers)) / 100;
      const active = ['accepted', 'on_the_way', 'arrived', 'in_progress', 'completed_by_cleaner'].includes(order.status);
      return <article className="card" key={order.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-emerald-700">{company?.name ?? 'Компания'}</p><h2 className="mt-1 text-xl font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{order.city}, {order.address_text}</p></div><span className="rounded-full bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700">{statusLabels[order.status] ?? order.status}</span></div><div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p>{new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p>{order.area_sq_m} м² · {order.rooms_count} комн.</p><p className="font-bold text-emerald-700">Ваш заработок: {earning.toLocaleString('ru-RU')} ₸</p></div>{active && <Link className="button mt-4 w-full" href="/cleaner/company-orders">Открыть и изменить этап</Link>}</article>;
    })}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Принятых заказов пока нет</p><p className="mt-2 text-sm text-slate-500">Заказ появится здесь сразу после того, как вы его возьмёте.</p><Link className="button mt-4" href="/cleaner/company-orders">Найти заказ</Link></div>}
  </div>;
}
