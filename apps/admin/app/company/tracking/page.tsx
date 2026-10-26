import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { CompanyTracking } from './tracking-board';

export default async function CompanyTrackingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'company_owner' || profile.status !== 'active') redirect('/company');
  return <div className="mx-auto max-w-6xl px-4 py-10"><Link href="/company" className="text-sm font-bold text-emerald-700">← Кабинет компании</Link><h1 className="mt-4 text-3xl font-black">Клинеры на карте</h1><p className="mt-2 text-sm text-slate-500">Показаны только активные заказы вашей компании. После завершения заказа или рабочего дня точки исчезают.</p><CompanyTracking /></div>;
}
