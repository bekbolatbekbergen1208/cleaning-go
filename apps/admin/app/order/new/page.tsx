import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { OrderForm } from './order-form';

export default async function NewOrderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: services }, { data: clientProfile }, { data: bonuses }] = await Promise.all([
    supabase.from('profiles').select('role,status').eq('id', user.id).single(),
    supabase.from('cleaning_services').select('id,name,description').eq('is_active', true).order('sort_order'),
    supabase.from('client_profiles').select('preferred_company_id,company_locked').eq('user_id', user.id).maybeSingle(),
    supabase.from('company_bonus_balances').select('company_id,balance_minor').eq('client_id', user.id),
  ]);

  if (profile?.role !== 'client' || profile.status !== 'active') redirect('/profile');

  // A linked company must be loaded even if an administrator changed its status
  // after the invitation code was applied. Otherwise the UI incorrectly reports
  // that the company disappeared and gives the client no useful explanation.
  const companyFields = 'id,name,rating,reviews_count,service_cities,verification_status';
  const { data: approvedCompanies, error: companiesError } = await supabase
    .from('company_profiles')
    .select(companyFields)
    .eq('verification_status', 'approved')
    .order('rating', { ascending: false });
  if (companiesError) throw new Error(`Не удалось загрузить компании: ${companiesError.message}`);

  const preferredCompanyId = clientProfile?.preferred_company_id ?? null;
  let lockedCompany = null;
  if (clientProfile?.company_locked && preferredCompanyId && !approvedCompanies?.some((company) => company.id === preferredCompanyId)) {
    const { data, error } = await supabase
      .from('company_profiles')
      .select(companyFields)
      .eq('id', preferredCompanyId)
      .maybeSingle();
    if (error) throw new Error(`Не удалось загрузить закреплённую компанию: ${error.message}`);
    lockedCompany = data;
  }

  const companies = lockedCompany ? [lockedCompany, ...(approvedCompanies ?? [])] : (approvedCompanies ?? []);

  return <div className="mx-auto max-w-2xl px-4 py-10">
    <h1 className="text-3xl font-black">Заказать клининг</h1>
    <p className="mt-2 text-sm text-slate-500">Компания посмотрит фотографию помещения и подтвердит итоговую цену.</p>
    <OrderForm
      services={services ?? []}
      companies={companies ?? []}
      preferredCompanyId={preferredCompanyId}
      companyLocked={Boolean(clientProfile?.company_locked)}
      bonusBalances={Object.fromEntries((bonuses ?? []).map((item) => [item.company_id, Number(item.balance_minor)]))}
    />
  </div>;
}
