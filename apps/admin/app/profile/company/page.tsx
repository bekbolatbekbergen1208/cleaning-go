import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { CompanyChoice } from './company-choice';

export default async function ChooseCompanyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: profile }, { data: client }, { data: companies, error }] = await Promise.all([
    supabase.from('profiles').select('role,status').eq('id', user.id).single(),
    supabase.from('client_profiles').select('preferred_company_id,company_locked').eq('user_id', user.id).single(),
    supabase.from('company_profiles').select('id,name,description,service_cities,rating,reviews_count,cashback_bps,welcome_bonus_minor').eq('verification_status', 'approved').order('rating', { ascending: false }),
  ]);
  if (profile?.role !== 'client' || profile.status !== 'active') redirect('/profile');
  return <div className="mx-auto max-w-3xl px-4 py-10">
    <p className="section-kicker">Клиентам</p>
    <h1 className="mt-2 text-3xl font-black">Выбрать компанию</h1>
    <p className="mt-2 text-sm text-slate-500">Сравните рейтинг, города и бонусы. Выбранная компания будет предложена при новом заказе.</p>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить компании: {error.message}</p> : <CompanyChoice companies={companies ?? []} preferredCompanyId={client?.preferred_company_id ?? null} locked={Boolean(client?.company_locked)} />}
  </div>;
}
