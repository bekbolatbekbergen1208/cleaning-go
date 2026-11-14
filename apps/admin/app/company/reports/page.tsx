import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/backend/server';
import { cleanerEarnings, loadReportOrders, serviceClient, serviceNames, statusBreakdown } from '../../../lib/report-data';
import { buildBuckets, money, parsePeriod, percent, periodStart } from '../../../lib/reports';
import { BarChart, Breakdown, Metric, PeriodTabs } from '../../../components/reports/report-ui';

export default async function CompanyReports({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect('/login');
  const db = serviceClient();
  const [{ data: profile }, { data: company }] = await Promise.all([
    db.from('profiles').select('role,status').eq('id', user.id).single(),
    db.from('company_profiles').select('id,name,rating,reviews_count').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner' || profile.status !== 'active' || !company) redirect('/login');

  const period = parsePeriod((await searchParams).period);
  const [orders, services] = await Promise.all([loadReportOrders(period, company.id), serviceNames()]);
  const completed = orders.filter((o) => o.status === 'completed');
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const revenue = completed.reduce((s, o) => s + o.total_minor, 0);
  const cleanersPaid = completed.reduce((s, o) => s + o.executor_amount_minor, 0);
  const platformFee = completed.reduce((s, o) => s + o.platform_fee_minor, 0);
  const cashback = completed.reduce((s, o) => s + o.company_cashback_minor, 0);
  const kept = revenue - cleanersPaid - platformFee - cashback;
  const unsettled = completed.filter((o) => !o.finances_finalized_at).length;
  const clientOrders = new Map<string, number>();
  for (const o of orders) clientOrders.set(o.client_id, (clientOrders.get(o.client_id) ?? 0) + 1);
  const repeatClients = [...clientOrders.values()].filter((n) => n > 1).length;

  const { data: reviews } = await db.from('reviews').select('rating,created_at').eq('company_id', company.id).eq('is_visible', true);
  const since = periodStart(period);
  const periodReviews = (reviews ?? []).filter((r: { created_at: string }) => !since || Date.parse(r.created_at) >= since.getTime());
  const avgRating = periodReviews.length ? periodReviews.reduce((s: number, r: { rating: number }) => s + Number(r.rating), 0) / periodReviews.length : 0;

  const revenueBuckets = buildBuckets(completed, (o) => o.completed_at ?? o.created_at, (o) => o.total_minor, period);
  const orderBuckets = buildBuckets(orders, (o) => o.created_at, () => 1, period);
  const byService = [...services.entries()]
    .map(([id, name]) => {
      const list = orders.filter((o) => o.service_id === id);
      return { name, orders: list.length, revenue: list.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total_minor, 0) };
    })
    .filter((s) => s.orders > 0)
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  const cleaners = await cleanerEarnings(orders);
  const count = (n: number) => n.toLocaleString('ru-RU');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/company" className="text-sm font-bold text-emerald-700">← Кабинет компании</Link>
      <h1 className="mt-4 text-3xl font-black">Отчёты · {company.name}</h1>
      <p className="mt-2 text-sm text-slate-500">Заказы считаются по дате создания, выручка — по дате завершения. Время — Казахстан (UTC+5).</p>
      <PeriodTabs
        base="/company/reports"
        period={period}
        extra={<a className="report-download" href={`/api/reports/orders?scope=company&period=${period}`} download>Скачать заказы (CSV)</a>}
      />

      <div className="report-metrics">
        <Metric label="Выручка" value={money(revenue)} hint={`${count(completed.length)} завершённых заказов`} />
        <Metric label="Остаётся компании" value={money(kept)} hint="после выплат клинерам, комиссии и кешбэка" />
        <Metric label="Средний чек" value={money(completed.length ? revenue / completed.length : 0)} />
        <Metric label="Заказов" value={count(orders.length)} hint={`завершено ${percent(completed.length, orders.length)} · отмен ${count(cancelled)}`} />
        <Metric label="Клиентов" value={count(clientOrders.size)} hint={`повторных: ${count(repeatClients)}`} />
        <Metric label="Рейтинг" value={avgRating ? avgRating.toFixed(1) : '—'} hint={`${count(periodReviews.length)} отзывов за период · всего ★ ${Number(company.rating).toFixed(1)}`} />
      </div>

      <div className="report-grid-2">
        <BarChart title="Выручка" summary={money(revenue)} buckets={revenueBuckets} format={money} />
        <BarChart title="Новые заказы" summary={count(orders.length)} buckets={orderBuckets} format={count} />
      </div>

      <div className="report-grid-2">
        <section className="report-card">
          <h2>Куда уходит выручка</h2>
          <table className="report-table">
            <tbody>
              <tr><td>Оплачено клиентами</td><td className="num"><b>{money(revenue)}</b></td></tr>
              <tr><td>− Выплаты клинерам</td><td className="num">{money(cleanersPaid)}</td></tr>
              <tr><td>− Комиссия платформы</td><td className="num">{money(platformFee)}</td></tr>
              <tr><td>− Кешбэк клиентам</td><td className="num">{money(cashback)}</td></tr>
              <tr><td><b>= Остаётся компании</b></td><td className="num"><b>{money(kept)}</b></td></tr>
            </tbody>
          </table>
          {unsettled > 0 && <p className="report-empty">{count(unsettled)} заверш. заказ(ов) ждут подтверждения оплаты: комиссия и кешбэк по ним появятся после оплаты.</p>}
        </section>
        <Breakdown title="Заказы по статусам" items={statusBreakdown(orders)} />
      </div>

      <div className="report-grid-2">
        <section className="report-card">
          <h2>Услуги</h2>
          {byService.length ? (
            <div className="responsive-table-wrap">
              <table className="report-table responsive-table">
                <thead><tr><th>Услуга</th><th className="num">Заказов</th><th className="num">Выручка</th></tr></thead>
                <tbody>{byService.map((s) => <tr key={s.name}><td data-label="Услуга">{s.name}</td><td className="num" data-label="Заказов">{count(s.orders)}</td><td className="num" data-label="Выручка">{money(s.revenue)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="report-empty">Нет заказов за период.</p>}
        </section>
        <section className="report-card">
          <h2>Клинеры</h2>
          {cleaners.length ? (
            <div className="responsive-table-wrap">
              <table className="report-table responsive-table">
                <thead><tr><th>Клинер</th><th className="num">Заказов</th><th className="num">Заработал</th><th className="num">Рейтинг</th></tr></thead>
                <tbody>{cleaners.map((c) => <tr key={c.id}><td data-label="Клинер">{c.name}</td><td className="num" data-label="Заказов">{count(c.orders)}</td><td className="num" data-label="Заработал">{money(c.earned)}</td><td className="num" data-label="Рейтинг">{c.reviews ? `★ ${c.rating.toFixed(1)}` : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="report-empty">Завершённых заказов с клинерами за период нет.</p>}
        </section>
      </div>
    </div>
  );
}
