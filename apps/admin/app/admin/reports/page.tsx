import { requireAdmin } from '../../../lib/require-admin';
import { cleanerEarnings, loadReportOrders, serviceClient, statusBreakdown } from '../../../lib/report-data';
import { buildBuckets, money, parsePeriod, percent, periodStart } from '../../../lib/reports';
import { BarChart, Breakdown, Metric, PeriodTabs } from '../../../components/reports/report-ui';

export default async function AdminReports({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const since = periodStart(period);
  const db = serviceClient();
  let usersQuery = db.from('profiles').select('role,created_at').neq('role', 'admin');
  if (since) usersQuery = usersQuery.gte('created_at', since.toISOString());
  const [orders, { data: newUsers }, { data: companies }] = await Promise.all([
    loadReportOrders(period),
    usersQuery,
    db.from('company_profiles').select('id,name,rating,reviews_count,verification_status'),
  ]);

  const completed = orders.filter((o) => o.status === 'completed');
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const gmv = completed.reduce((s, o) => s + o.total_minor, 0);
  const fee = completed.reduce((s, o) => s + o.platform_fee_minor, 0);
  const rewards = completed.reduce((s, o) => s + o.referral_reward_minor + o.company_cashback_minor, 0);
  const unsettled = completed.filter((o) => !o.finances_finalized_at).length;
  const roleCount = (role: string) => (newUsers ?? []).filter((u: { role: string }) => u.role === role).length;

  const companyRows = (companies ?? [])
    .map((c: { id: string; name: string; rating: number; reviews_count: number }) => {
      const list = orders.filter((o) => o.selected_company_id === c.id);
      const done = list.filter((o) => o.status === 'completed');
      return {
        id: c.id,
        name: c.name,
        orders: list.length,
        completed: done.length,
        cancelled: list.filter((o) => o.status === 'cancelled').length,
        gmv: done.reduce((s, o) => s + o.total_minor, 0),
        fee: done.reduce((s, o) => s + o.platform_fee_minor, 0),
        rating: Number(c.rating),
        reviews: Number(c.reviews_count),
      };
    })
    .filter((c) => c.orders > 0)
    .sort((a, b) => b.gmv - a.gmv || b.orders - a.orders);
  const direct = orders.filter((o) => !o.selected_company_id);
  const cities = [...new Set(orders.map((o) => o.city.trim()))]
    .map((city) => {
      const list = orders.filter((o) => o.city.trim() === city);
      return { city, orders: list.length, gmv: list.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total_minor, 0) };
    })
    .sort((a, b) => b.gmv - a.gmv || b.orders - a.orders);
  const cleaners = (await cleanerEarnings(orders)).slice(0, 10);
  const count = (n: number) => n.toLocaleString('ru-RU');

  return (
    <>
      <h1 className="text-3xl font-black">Отчёт платформы</h1>
      <p className="mt-2 text-sm text-slate-500">Заказы считаются по дате создания, оборот — по дате завершения. Время — Казахстан (UTC+5).</p>
      <PeriodTabs
        base="/admin/reports"
        period={period}
        extra={<a className="report-download" href={`/api/reports/orders?scope=admin&period=${period}`} download>Скачать заказы (CSV)</a>}
      />

      <div className="report-metrics">
        <Metric label="Оборот" value={money(gmv)} hint={`${count(completed.length)} завершённых заказов`} />
        <Metric label="Комиссия платформы" value={money(fee)} hint={gmv ? `${((fee / gmv) * 100).toFixed(1)}% оборота` : undefined} />
        <Metric label="Средний чек" value={money(completed.length ? gmv / completed.length : 0)} />
        <Metric label="Заказов" value={count(orders.length)} hint={`завершено ${percent(completed.length, orders.length)} · отмен ${count(cancelled)}`} />
        <Metric label="Новых пользователей" value={count((newUsers ?? []).length)} hint={`клиенты ${count(roleCount('client'))} · клинеры ${count(roleCount('cleaner'))} · компании ${count(roleCount('company_owner'))}`} />
        <Metric label="Бонусы клиентам" value={money(rewards)} hint="рефералы и кешбэк компаний" />
      </div>
      {unsettled > 0 && <p className="report-empty">{count(unsettled)} заверш. заказ(ов) ждут подтверждения оплаты: комиссия по ним появится после оплаты.</p>}

      <div className="report-grid-2">
        <BarChart title="Оборот" summary={money(gmv)} buckets={buildBuckets(completed, (o) => o.completed_at ?? o.created_at, (o) => o.total_minor, period)} format={money} />
        <BarChart title="Новые заказы" summary={count(orders.length)} buckets={buildBuckets(orders, (o) => o.created_at, () => 1, period)} format={count} />
      </div>

      <div className="report-grid-2">
        <Breakdown title="Заказы по статусам" items={statusBreakdown(orders)} />
        <Breakdown
          title="Кто выполняет заказы"
          items={[
            { label: 'Компании', value: orders.length - direct.length },
            { label: 'Частные клинеры напрямую', value: direct.length },
          ].filter((i) => i.value > 0)}
        />
      </div>

      <section className="report-card report-section">
        <h2>Компании</h2>
        {companyRows.length ? (
          <div className="responsive-table-wrap">
            <table className="report-table responsive-table">
              <thead><tr><th>Компания</th><th className="num">Заказов</th><th className="num">Завершено</th><th className="num">Отмены</th><th className="num">Оборот</th><th className="num">Комиссия</th><th className="num">Рейтинг</th></tr></thead>
              <tbody>{companyRows.map((c) => (
                <tr key={c.id}>
                  <td data-label="Компания">{c.name}</td>
                  <td className="num" data-label="Заказов">{count(c.orders)}</td>
                  <td className="num" data-label="Завершено">{percent(c.completed, c.orders)}</td>
                  <td className="num" data-label="Отмены">{count(c.cancelled)}</td>
                  <td className="num" data-label="Оборот">{money(c.gmv)}</td>
                  <td className="num" data-label="Комиссия">{money(c.fee)}</td>
                  <td className="num" data-label="Рейтинг">{c.reviews ? `★ ${c.rating.toFixed(1)}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="report-empty">У компаний нет заказов за период.</p>}
      </section>

      <div className="report-grid-2">
        <section className="report-card">
          <h2>Лучшие клинеры</h2>
          {cleaners.length ? (
            <div className="responsive-table-wrap">
              <table className="report-table responsive-table">
                <thead><tr><th>Клинер</th><th className="num">Заказов</th><th className="num">Заработал</th><th className="num">Рейтинг</th></tr></thead>
                <tbody>{cleaners.map((c) => <tr key={c.id}><td data-label="Клинер">{c.name}</td><td className="num" data-label="Заказов">{count(c.orders)}</td><td className="num" data-label="Заработал">{money(c.earned)}</td><td className="num" data-label="Рейтинг">{c.reviews ? `★ ${c.rating.toFixed(1)}` : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="report-empty">Завершённых заказов за период нет.</p>}
        </section>
        <section className="report-card">
          <h2>Города</h2>
          {cities.length ? (
            <div className="responsive-table-wrap">
              <table className="report-table responsive-table">
                <thead><tr><th>Город</th><th className="num">Заказов</th><th className="num">Оборот</th></tr></thead>
                <tbody>{cities.map((c) => <tr key={c.city}><td data-label="Город">{c.city}</td><td className="num" data-label="Заказов">{count(c.orders)}</td><td className="num" data-label="Оборот">{money(c.gmv)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="report-empty">Нет заказов за период.</p>}
        </section>
      </div>
    </>
  );
}
