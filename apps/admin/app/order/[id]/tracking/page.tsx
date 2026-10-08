import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { trackingAccess } from '../../../../lib/tracking';
import { OrderTracking } from '../../../../components/maps/order-tracking';

export default async function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const access = await trackingAccess(id);
  if (!access) notFound();
  const back = access.isCleaner ? '/cleaner/my-work' : access.order.client_id === user.id ? '/profile' : '/company/orders';
  return <div className="mx-auto max-w-5xl py-5"><Link href={back} className="text-sm font-bold text-emerald-700">← К заказам</Link><div className="my-5"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Карта заказа</p><h1 className="mt-2 text-3xl font-black">Заказ {access.order.order_number}</h1><p className="mt-2 text-slate-500">{access.order.city}, {access.order.address_text}</p></div><OrderTracking orderId={id} /></div>;
}
