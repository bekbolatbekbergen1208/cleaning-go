import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/backend/server';
import { loadReportOrders, serviceClient, serviceNames } from '../../../../lib/report-data';
import { orderStatusNames } from '../../../../lib/labels';
import { REPORT_TZ, parsePeriod, toCsv } from '../../../../lib/reports';

const when = new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TZ, dateStyle: 'short', timeStyle: 'short' });
const tenge = (minor: number) => Math.round(minor) / 100;

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get('scope');
  const period = parsePeriod(request.nextUrl.searchParams.get('period') ?? undefined);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: 'Сначала войдите в аккаунт' }, { status: 401 });
  const db = serviceClient();
  const { data: profile } = await db.from('profiles').select('role,status').eq('id', user.id).single();
  if (profile?.status !== 'active') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });

  let companyId: string | undefined;
  if (scope === 'admin') {
    // Same rule as requireAdmin(): the admin role and the configured owner e-mail.
    const owner = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    if (profile.role !== 'admin' || !owner || user.email?.toLowerCase() !== owner) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  } else if (scope === 'company') {
    const { data: company } = await db.from('company_profiles').select('id').eq('owner_id', user.id).maybeSingle();
    if (profile.role !== 'company_owner' || !company) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    companyId = company.id;
  } else return NextResponse.json({ error: 'Неизвестный отчёт' }, { status: 400 });

  const [orders, services] = await Promise.all([loadReportOrders(period, companyId), serviceNames()]);
  const clientIds = [...new Set(orders.map((o) => o.client_id))];
  const companyIds = [...new Set(orders.map((o) => o.selected_company_id).filter(Boolean))] as string[];
  const [{ data: clients }, { data: companies }] = await Promise.all([
    clientIds.length ? db.from('profiles').select('id,full_name').in('id', clientIds) : { data: [] },
    companyIds.length ? db.from('company_profiles').select('id,name').in('id', companyIds) : { data: [] },
  ]);
  const clientName = new Map(((clients ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  const companyName = new Map(((companies ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const header = ['Номер', 'Создан', 'Завершён', 'Статус', 'Город', 'Услуга', ...(scope === 'admin' ? ['Исполнитель'] : []), 'Клиент', 'Сумма, ₸', 'Клинерам, ₸', 'Комиссия, ₸', 'Кешбэк, ₸', 'Оплата'];
  const rows = orders.map((o) => [
    o.order_number,
    when.format(new Date(o.created_at)),
    o.completed_at ? when.format(new Date(o.completed_at)) : '',
    orderStatusNames[o.status] ?? o.status,
    o.city,
    services.get(o.service_id) ?? '',
    ...(scope === 'admin' ? [o.selected_company_id ? companyName.get(o.selected_company_id) ?? '' : 'Частный клинер'] : []),
    clientName.get(o.client_id) ?? '',
    tenge(o.total_minor),
    tenge(o.executor_amount_minor),
    tenge(o.platform_fee_minor),
    tenge(o.company_cashback_minor),
    o.payment_status === 'paid' ? 'Оплачен' : o.payment_status === 'refunded' ? 'Возврат' : 'Ожидает',
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(header, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cleaning-go-orders-${scope}-${period}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
