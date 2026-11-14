import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/backend/server';
import { serviceClient } from '../../../../lib/report-data';
import { ReviewForm } from './review-form';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();
  if (!user) redirect('/login');
  const { data: order } = await backend.from('orders').select('id,order_number,status,selected_company_id,selected_cleaner_id,reviews(id)').eq('id', id).eq('client_id', user.id).maybeSingle();
  if (!order || order.status !== 'completed' || order.reviews?.length) redirect('/profile');

  // Ownership is checked above with the client's own session; the service key
  // only reads who worked on this order and the company's name.
  const db = serviceClient();
  const [{ data: workers }, { data: company }] = await Promise.all([
    order.selected_company_id
      ? db.from('order_workers').select('cleaner_id').eq('order_id', order.id)
      : { data: order.selected_cleaner_id ? [{ cleaner_id: order.selected_cleaner_id }] : [] },
    order.selected_company_id
      ? db.from('company_profiles').select('name').eq('id', order.selected_company_id).maybeSingle()
      : { data: null },
  ]);
  const ids = [...new Set((workers ?? []).map((w: { cleaner_id: string }) => w.cleaner_id))];
  const { data: names } = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : { data: [] };
  const cleaners = ids.map((cleanerId) => ({
    id: cleanerId,
    name: ((names ?? []).find((n: { id: string }) => n.id === cleanerId) as { full_name?: string } | undefined)?.full_name ?? 'Клинер',
  }));

  return <div className="mx-auto max-w-lg px-4 py-10">
    <h1 className="text-3xl font-black">Оцените уборку</h1>
    <p className="mt-2 text-sm text-slate-500">Заказ {order.order_number}. Оценки влияют на рейтинг {company ? 'компании и каждого клинера' : 'клинера'}.</p>
    <ReviewForm orderId={order.id} company={company ? { name: (company as { name: string }).name } : null} cleaners={cleaners} />
  </div>;
}
