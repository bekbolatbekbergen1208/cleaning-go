import { createClient } from '@cleaning-go/local-client';
import type { PeriodKey } from './reports';
import { periodStart } from './reports';

export type ReportOrder = {
  id: string;
  order_number: string;
  client_id: string;
  status: string;
  payment_status: string;
  total_minor: number;
  executor_amount_minor: number;
  platform_fee_minor: number;
  company_cashback_minor: number;
  referral_reward_minor: number;
  service_id: string;
  selected_company_id: string | null;
  selected_cleaner_id: string | null;
  city: string;
  created_at: string;
  completed_at: string | null;
  finances_finalized_at: string | null;
};

const orderColumns =
  'id,order_number,client_id,status,payment_status,total_minor,executor_amount_minor,platform_fee_minor,company_cashback_minor,referral_reward_minor,service_id,selected_company_id,selected_cleaner_id,city,created_at,completed_at,finances_finalized_at';

// Reports read with the service key; callers must check the role first.
export function serviceClient() {
  return createClient(process.env.LOCAL_API_URL || 'http://127.0.0.1:54321', process.env.LOCAL_SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadReportOrders(period: PeriodKey, companyId?: string) {
  const db = serviceClient();
  let query = db.from('orders').select(orderColumns);
  if (companyId) query = query.eq('selected_company_id', companyId);
  const since = periodStart(period);
  if (since) query = query.gte('created_at', since.toISOString());
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(`Не удалось загрузить заказы: ${error.message}`);
  return ((data ?? []) as ReportOrder[]).map((order) => ({
    ...order,
    total_minor: Number(order.total_minor),
    executor_amount_minor: Number(order.executor_amount_minor),
    platform_fee_minor: Number(order.platform_fee_minor),
    company_cashback_minor: Number(order.company_cashback_minor),
    referral_reward_minor: Number(order.referral_reward_minor),
  }));
}

export const statusGroups: [string, string[]][] = [
  ['Ждут цену или исполнителя', ['created', 'searching']],
  ['Цена предложена клиенту', ['offered']],
  ['В работе', ['accepted', 'on_the_way', 'arrived', 'in_progress', 'completed_by_cleaner']],
  ['Завершены', ['completed']],
  ['Отменены', ['cancelled']],
  ['Спор', ['disputed']],
];

export function statusBreakdown(orders: ReportOrder[]) {
  return statusGroups
    .map(([label, statuses]) => ({ label, value: orders.filter((o) => statuses.includes(o.status)).length }))
    .filter((item) => item.value > 0);
}

// What each cleaner earned: direct orders pay the selected cleaner; company
// orders split the agreed payout evenly between the assigned workers.
export async function cleanerEarnings(orders: ReportOrder[]) {
  const db = serviceClient();
  const completed = orders.filter((o) => o.status === 'completed');
  const companyOrderIds = completed.filter((o) => o.selected_company_id).map((o) => o.id);
  const { data: workers } = companyOrderIds.length
    ? await db.from('order_workers').select('order_id,cleaner_id').in('order_id', companyOrderIds)
    : { data: [] as { order_id: string; cleaner_id: string }[] };
  const byOrder = new Map<string, string[]>();
  for (const w of workers ?? []) byOrder.set(w.order_id, [...(byOrder.get(w.order_id) ?? []), w.cleaner_id]);
  const stats = new Map<string, { orders: number; earned: number }>();
  const credit = (cleanerId: string, amount: number) => {
    const current = stats.get(cleanerId) ?? { orders: 0, earned: 0 };
    stats.set(cleanerId, { orders: current.orders + 1, earned: current.earned + amount });
  };
  for (const order of completed) {
    const team = order.selected_company_id ? byOrder.get(order.id) ?? [] : order.selected_cleaner_id ? [order.selected_cleaner_id] : [];
    for (const cleanerId of team) credit(cleanerId, Math.round(order.executor_amount_minor / team.length));
  }
  const ids = [...stats.keys()];
  const [{ data: names }, { data: profiles }] = ids.length
    ? await Promise.all([
        db.from('profiles').select('id,full_name').in('id', ids),
        db.from('cleaner_profiles').select('user_id,rating,reviews_count').in('user_id', ids),
      ])
    : [{ data: [] }, { data: [] }];
  return ids
    .map((id) => {
      const profile = (profiles ?? []).find((p: { user_id: string }) => p.user_id === id) as { rating?: number; reviews_count?: number } | undefined;
      return {
        id,
        name: ((names ?? []).find((n: { id: string }) => n.id === id) as { full_name?: string } | undefined)?.full_name ?? 'Клинер',
        rating: Number(profile?.rating ?? 0),
        reviews: Number(profile?.reviews_count ?? 0),
        ...stats.get(id)!,
      };
    })
    .sort((a, b) => b.orders - a.orders || b.earned - a.earned);
}

export async function serviceNames() {
  const { data } = await serviceClient().from('cleaning_services').select('id,name');
  return new Map((data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
}
