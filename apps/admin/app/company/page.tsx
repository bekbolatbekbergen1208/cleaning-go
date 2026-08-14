import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabase/server';

export default async function CompanyHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase.from('profiles').select('full_name,role').eq('id', user.id).single(),
    supabase.from('company_profiles').select('name,company_code,verification_status,rating,reviews_count').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner') redirect('/');

  return <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
    <section className="flex items-center gap-4 border-b border-slate-200 pb-6 sm:gap-6">
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-800 text-3xl font-black text-white ring-4 ring-emerald-50">{(company?.name ?? 'C').slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0"><h1 className="truncate text-2xl font-black sm:text-3xl">{company?.name ?? 'Ваша компания'}</h1><p className="mt-1 text-sm text-slate-500">{profile.full_name}</p><span className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{company?.verification_status ?? 'pending'}</span></div>
    </section>
    <div className="grid grid-cols-3 border-b border-slate-200 py-5 text-center">
      <div><b className="block text-lg">{company?.rating ?? 0} ★</b><span className="text-xs text-slate-500">рейтинг</span></div>
      <div><b className="block text-lg">{company?.reviews_count ?? 0}</b><span className="text-xs text-slate-500">отзывов</span></div>
      <div><b className="block truncate px-2 text-lg">{company?.company_code ?? '—'}</b><span className="text-xs text-slate-500">код</span></div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <section className="card"><p className="text-lg font-black">Отдел продаж</p><p className="mt-1 text-sm text-slate-500">Клиенты, зарегистрированные по коду компании.</p><Link href="/company/sales" className="button mt-4 w-full">Открыть клиентов</Link></section>
      <section className="card"><p className="text-lg font-black">Заказы</p><p className="mt-1 text-sm text-slate-500">Новые заявки и текущие уборки компании.</p><span className="button mt-4 w-full opacity-60">Скоро</span></section>
    </div>
  </div>;
}
