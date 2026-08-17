import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { OrderForm } from './order-form';

export default async function NewOrderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: services }, { data: companies }, { data: clientProfile }, { data: bonuses }] = await Promise.all([
    supabase.from('profiles').select('role,status').eq('id', user.id).single(),
    supabase.from('cleaning_services').select('id,name,description').eq('is_active', true).order('sort_order'),
    supabase.from('company_profiles').select('id,name,rating,reviews_count,service_cities').eq('verification_status', 'approved').order('rating', { ascending: false }),
    supabase.from('client_profiles').select('preferred_company_id,company_locked').eq('user_id', user.id).maybeSingle(),
    supabase.from('company_bonus_balances').select('company_id,balance_minor').eq('client_id', user.id),
  ]);

  if (profile?.role !== 'client' || profile.status !== 'active') redirect('/profile');

  return <div className="mx-auto max-w-2xl px-4 py-10">
    <h1 className="text-3xl font-black">Заказать клининг</h1>
    <p className="mt-2 text-sm text-slate-500">Компания посмотрит фотографию помещения и подтвердит итоговую цену.</p>
    <OrderForm
      services={services ?? []}
      companies={companies ?? []}
      preferredCompanyId={clientProfile?.preferred_company_id ?? null}
      companyLocked={Boolean(clientProfile?.company_locked)}
      bonusBalances={Object.fromEntries((bonuses ?? []).map((item) => [item.company_id, Number(item.balance_minor)]))}
    />
  </div>;
}
