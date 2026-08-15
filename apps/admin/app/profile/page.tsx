import { redirect } from 'next/navigation';
import Link from 'next/link';
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

  const [{ data: wallet }, { data: bonuses }, { data: orders }, { data: referral }] = await Promise.all([
    supabase.from('wallets').select('available_minor,pending_minor,currency').eq('owner_id', user.id).maybeSingle(),
    supabase.from('company_bonus_balances').select('balance_minor').eq('client_id', user.id),
    supabase.from('orders').select('id,order_number,status,scheduled_at,total_minor').eq('client_id', user.id).order('created_at', { ascending: false }).limit(3),
    supabase.from('referral_codes').select('code').eq('owner_id', user.id).maybeSingle(),
  ]);
  const companyBonusMinor = (bonuses ?? []).reduce((sum, item) => sum + Number(item.balance_minor), 0);
  const money = (minor: number | null | undefined) => `${(Number(minor ?? 0) / 100).toLocaleString('ru-RU')} ₸`;

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
      {profile?.role === 'client' && <Link href="/order/new" className="button mt-6 w-full">Заказать клининг</Link>}
      <div className="mt-8 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs text-emerald-700">Доступно</p><p className="mt-1 text-xl font-black">{money(wallet?.available_minor)}</p></div>
        <div className="rounded-2xl bg-lime-50 p-4"><p className="text-xs text-lime-800">Бонус компании</p><p className="mt-1 text-xl font-black">{money(companyBonusMinor)}</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Ожидается</p><p className="mt-1 text-xl font-black">{money(wallet?.pending_minor)}</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Реферальный код</p><p className="mt-1 truncate text-lg font-black">{referral?.code ?? '—'}</p></div>
      </div>
      <dl className="mt-8 space-y-4 text-sm">
        <div><dt className="text-slate-400">Email</dt><dd className="mt-1 font-semibold">{profile?.email ?? user.email ?? '—'}</dd></div>
        <div><dt className="text-slate-400">Телефон</dt><dd className="mt-1 font-semibold">{profile?.phone ?? '—'}</dd></div>
        <div><dt className="text-slate-400">Статус</dt><dd className="mt-1 font-semibold">{profile?.status === 'active' ? 'Активен' : profile?.status ?? '—'}</dd></div>
      </dl>
      {profile?.role === 'client' && <div className="mt-8">
        <h2 className="text-lg font-black">Последние заказы</h2>
        <div className="mt-3 space-y-2">{orders?.length ? orders.map((order) => <div className="rounded-2xl border border-slate-200 p-4" key={order.id}>
          <div className="flex items-center justify-between gap-3"><b>{order.order_number}</b><span className="text-xs font-semibold text-emerald-700">{order.status}</span></div>
          <p className="mt-1 text-xs text-slate-500">{new Date(order.scheduled_at).toLocaleString('ru-RU')} · {money(order.total_minor)}</p>
        </div>) : <p className="text-sm text-slate-500">Заказов пока нет.</p>}</div>
      </div>}
      <form action={signOut} className="mt-8">
        <button className="button w-full" type="submit">Выйти</button>
      </form>
    </section>
  </div>;
}
