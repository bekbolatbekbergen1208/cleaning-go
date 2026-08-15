import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { ReviewForm } from './review-form';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: order } = await supabase.from('orders').select('id,order_number,status,reviews(id)').eq('id', id).eq('client_id', user.id).maybeSingle();
  if (!order || order.status !== 'completed' || order.reviews?.length) redirect('/profile');
  return <div className="mx-auto max-w-lg px-4 py-10">
    <h1 className="text-3xl font-black">Оцените уборку</h1>
    <p className="mt-2 text-sm text-slate-500">Заказ {order.order_number}. Ваша оценка повлияет на рейтинг компании.</p>
    <ReviewForm orderId={order.id} />
  </div>;
}
