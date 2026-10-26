import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

type ReportOrder = { client_id: string; status: string; total_minor: number; executor_amount_minor: number; company_cashback_minor: number; created_at: string };

export default async function CompanyReports({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect('/login');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: company }] = await Promise.all([
    admin.from('profiles').select('role,status').eq('id', user.id).single(),
    admin.from('company_profiles').select('id,name').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner' || profile.status !== 'active' || !company) redirect('/login');
  const params = await searchParams;
  const period = params.period === '7' ? 7 : params.period === 'all' ? 0 : 30;
  let query = admin.from('orders').select('client_id,status,total_minor,executor_amount_minor,company_cashback_minor,created_at').eq('selected_company_id', company.id);
  if (period) query = query.gte('created_at', new Date(Date.now() - period * 86400000).toISOString());
  const [{ data, error }, { data: membership }] = await Promise.all([
    query.order('created_at', { ascending: false }),
    admin.from('community_companies').select('community_id').eq('company_id', company.id).maybeSingle(),
  ]);
  const { count: cleaners } = membership ? await admin.from('community_cleaners').select('cleaner_id', { count: 'exact', head: true }).eq('community_id', membership.community_id) : { count: 0 };
  const orders = (data ?? []) as ReportOrder[];
  const completed = orders.filter(order => order.status === 'completed');
  const revenue = completed.reduce((sum, order) => sum + Number(order.executor_amount_minor || order.total_minor || 0), 0);
  const cashback = completed.reduce((sum, order) => sum + Number(order.company_cashback_minor ?? 0), 0);
  const active = orders.filter(order => !['completed', 'cancelled'].includes(order.status)).length;
  const cancelled = orders.filter(order => order.status === 'cancelled').length;
  const money = (minor: number) => `${(minor / 100).toLocaleString('ru-RU')} ₸`;
  const metric = (label: string, value: string | number) => <div className="card" key={label}><b className="text-2xl text-emerald-700">{value}</b><p className="mt-1 text-sm text-slate-500">{label}</p></div>;
  return <div className="mx-auto max-w-5xl px-4 py-10">
    <Link href="/company" className="text-sm font-bold text-emerald-700">← Кабинет компании</Link>
    <h1 className="mt-4 text-3xl font-black">Отчёты · {company.name}</h1>
    <p className="mt-2 text-sm text-slate-500">Показатели рассчитываются автоматически по заказам выбранного периода.</p>
    <nav aria-label="Период отчёта" className="mt-5 flex flex-wrap gap-2">{([[7, '7 дней'], [30, '30 дней'], [0, 'Всё время']] as const).map(([days, label]) => <Link key={days} href={`/company/reports?period=${days || 'all'}`} aria-current={period === days ? 'page' : undefined} className={period === days ? 'button' : 'rounded-xl border border-slate-300 px-4 py-3 font-bold'}>{label}</Link>)}</nav>
    {error ? <p className="card mt-6 text-red-600">Не удалось построить отчёт: {error.message}</p> : <>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{metric('Всего заказов', orders.length)}{metric('Активных', active)}{metric('Завершено', completed.length)}{metric('Клиентов', new Set(orders.map(order => order.client_id)).size)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="card space-y-3"><h2 className="text-xl font-black">Финансы</h2><p>Сумма исполнителям: <b>{money(revenue)}</b></p><p>Средний чек: <b>{money(completed.length ? Math.round(revenue / completed.length) : 0)}</b></p><p>Кешбэк клиентам: <b>{money(cashback)}</b></p></section>
        <section className="card space-y-3"><h2 className="text-xl font-black">Эффективность</h2><p>Выполнено заказов: <b>{orders.length ? Math.round(completed.length / orders.length * 100) : 0}%</b></p><p>Отменено: <b>{cancelled}</b></p><p>Клинеров в сообществе: <b>{cleaners ?? 0}</b></p></section>
      </div>
      {!orders.length && <p className="card mt-4">За выбранный период данных нет.</p>}
    </>}
  </div>;
}
