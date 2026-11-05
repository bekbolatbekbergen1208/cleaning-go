import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/backend/server';
import { CompanyChoice } from './company-choice';

export default async function ChooseCompanyPage() {
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: profile }, { data: client }, { data: companies, error }] = await Promise.all([
    backend.from('profiles').select('role,status,city').eq('id', user.id).single(),
    backend.from('client_profiles').select('preferred_company_id,company_locked').eq('user_id', user.id).single(),
    backend.from('company_profiles').select('id,name,description,service_cities,rating,reviews_count,cashback_bps,welcome_bonus_minor').eq('verification_status', 'approved').order('rating', { ascending: false }),
  ]);
  if (profile?.role !== 'client' || profile.status !== 'active') redirect('/profile');
  return <div className="mx-auto max-w-3xl px-4 py-10">
    <p className="section-kicker">Клиентам</p>
    <h1 className="mt-2 text-3xl font-black">Выбрать компанию</h1>
    <p className="mt-2 text-sm text-slate-500">Выберите свой город, затем клининговую компанию. Если вы зарегистрировались по специальному коду, компания уже закреплена за вами.</p>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить компании: {error.message}</p> : <CompanyChoice companies={companies ?? []} initialCity={profile.city ?? ''} preferredCompanyId={client?.preferred_company_id ?? null} locked={Boolean(client?.company_locked)} />}
  </div>;
}
