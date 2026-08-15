import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

const roleNames: Record<string, string> = {
  client: 'Клиент',
  cleaner: 'Клинер',
  company_cleaner: 'Сотрудник компании',
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,email,phone,role,status')
    .eq('id', user.id)
    .single();

  if (profile?.role === 'admin') redirect('/admin');
  if (profile?.role === 'company_owner') redirect('/company');

  async function signOut() {
    'use server';
    const serverClient = await createClient();
    await serverClient.auth.signOut();
    redirect('/login');
  }

  return <div className="mx-auto max-w-lg px-4 py-10">
    <section className="card">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Профиль</p>
      <h1 className="mt-3 text-3xl font-black">{profile?.full_name ?? 'Пользователь'}</h1>
      <p className="mt-2 text-sm font-semibold text-emerald-700">{roleNames[profile?.role ?? ''] ?? 'Пользователь'}</p>
      <dl className="mt-8 space-y-4 text-sm">
        <div><dt className="text-slate-400">Email</dt><dd className="mt-1 font-semibold">{profile?.email ?? user.email ?? '—'}</dd></div>
        <div><dt className="text-slate-400">Телефон</dt><dd className="mt-1 font-semibold">{profile?.phone ?? '—'}</dd></div>
        <div><dt className="text-slate-400">Статус</dt><dd className="mt-1 font-semibold">{profile?.status === 'active' ? 'Активен' : profile?.status ?? '—'}</dd></div>
      </dl>
      <form action={signOut} className="mt-8">
        <button className="button w-full" type="submit">Выйти</button>
      </form>
    </section>
  </div>;
}
