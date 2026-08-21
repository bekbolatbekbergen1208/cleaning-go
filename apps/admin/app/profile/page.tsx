import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../lib/supabase/server';
import { InvitationCard } from './invitation-card';
import { confirmCompanyPrice, confirmOrderCompletion } from './actions';

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

  const [{ data: wallet }, { data: bonuses }, { data: ledger }, { data: orders }, { data: referral }, { data: clientProfile }, { data: notifications }] = await Promise.all([
    supabase.from('wallets').select('available_minor,pending_minor,currency').eq('owner_id', user.id).maybeSingle(),
    supabase.from('company_bonus_balances').select('company_id,balance_minor,company_profiles(name)').eq('client_id', user.id),
    supabase.from('company_bonus_ledger').select('id,operation,amount_minor,description,created_at,company_profiles(name)').eq('client_id', user.id).order('created_at', { ascending: false }).limit(10),
    supabase.from('orders').select('id,order_number,status,scheduled_at,total_minor,price_confirmed_at,photo_urls,reviews(id)').eq('client_id', user.id).order('created_at', { ascending: false }).limit(3),
    supabase.from('referral_codes').select('code').eq('owner_id', user.id).maybeSingle(),
    supabase.from('client_profiles').select('company_locked,preferred_company_id,company_profiles(name)').eq('user_id', user.id).maybeSingle(),
    supabase.from('notifications').select('id,title,body,created_at,read_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
  ]);
  const companyBonusMinor = (bonuses ?? []).reduce((sum, item) => sum + Number(item.balance_minor), 0);
  const money = (minor: number | null | undefined) => `${(Number(minor ?? 0) / 100).toLocaleString('ru-RU')} ₸`;
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const completionPhotos = new Map<string, string[]>();
  await Promise.all((orders ?? []).map(async order => {
    const paths = ((order.photo_urls ?? []) as string[]).filter(path => path.includes('/completion-'));
    if (!paths.length) return;
    const { data } = await admin.storage.from('order-photos').createSignedUrls(paths, 3600);
    completionPhotos.set(order.id, (data ?? []).map(item => item.signedUrl).filter(Boolean));
  }));

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
      {(profile?.role === 'cleaner' || profile?.role === 'company_cleaner') && <Link href="/cleaner/company-orders" className="button mt-6 w-full">Заказы компании</Link>}
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
      {profile?.role === 'client' && <InvitationCard referralCode={referral?.code ?? null} companyName={(clientProfile?.company_profiles as { name?: string } | null)?.name ?? null} locked={Boolean(clientProfile?.company_locked)} />}
      {profile?.role === 'client' && Boolean(bonuses?.length) && <div className="mt-8"><h2 className="text-lg font-black">Бонусы по компаниям</h2><div className="mt-3 space-y-2">{bonuses?.map((bonus) => <div key={bonus.company_id} className="flex justify-between rounded-2xl bg-lime-50 p-4 text-sm"><span>{(bonus.company_profiles as { name?: string } | null)?.name ?? 'Компания'}</span><b>{money(bonus.balance_minor)}</b></div>)}</div></div>}
      {profile?.role === 'client' && Boolean(ledger?.length) && <div className="mt-8"><h2 className="text-lg font-black">История бонусов</h2><div className="mt-3 space-y-2">{ledger?.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-sm"><div><b>{item.description ?? item.operation}</b><p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('ru-RU')}</p></div><b className={item.operation === 'order_use' ? 'text-red-600' : 'text-emerald-700'}>{item.operation === 'order_use' ? '−' : '+'}{money(item.amount_minor)}</b></div>)}</div></div>}
      {profile?.role === 'client' && <div className="mt-8">
        <h2 className="text-lg font-black">Последние заказы</h2>
        <div className="mt-3 space-y-2">{orders?.length ? orders.map((order) => <div className="rounded-2xl border border-slate-200 p-4" key={order.id}>
          <div className="flex items-center justify-between gap-3"><b>{order.order_number}</b><span className="text-xs font-semibold text-emerald-700">{order.status}</span></div>
          <p className="mt-1 text-xs text-slate-500">{new Date(order.scheduled_at).toLocaleString('ru-RU')} · {money(order.total_minor)}</p>
          {order.status === 'offered' && !order.price_confirmed_at && <form action={confirmCompanyPrice} className="mt-3"><input type="hidden" name="order_id" value={order.id}/><p className="mb-2 text-sm font-semibold">Компания предложила цену {money(order.total_minor)}</p><button className="button w-full">Подтвердить цену</button></form>}
          {order.status === 'offered' && order.price_confirmed_at && <p className="mt-2 text-xs font-semibold text-emerald-700">Цена подтверждена. Компания формирует команду.</p>}
          {order.status === 'completed_by_cleaner' && <form action={confirmOrderCompletion} className="mt-3"><input type="hidden" name="order_id" value={order.id}/><p className="mb-2 text-sm font-semibold">Клинер завершил уборку. Проверьте результат.</p><button className="button w-full">Подтвердить завершение</button></form>}
          {Boolean(completionPhotos.get(order.id)?.length) && <div className="mt-3"><p className="mb-2 text-sm font-bold">Фотоотчёт клинера</p><div className="grid grid-cols-2 gap-2">{completionPhotos.get(order.id)?.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}><img className="h-32 w-full rounded-xl object-cover" src={url} alt={`Фотоотчёт ${index + 1}`}/></a>)}</div></div>}
          {order.status === 'completed' && !order.reviews?.length && <Link className="mt-3 inline-flex text-sm font-bold text-emerald-700" href={`/order/${order.id}/review`}>Оценить уборку →</Link>}
          {order.reviews?.length ? <p className="mt-2 text-xs font-semibold text-emerald-700">Отзыв опубликован</p> : null}
        </div>) : <p className="text-sm text-slate-500">Заказов пока нет.</p>}</div>
      </div>}
      {Boolean(notifications?.length) && <div className="mt-8"><h2 className="text-lg font-black">Уведомления</h2><div className="mt-3 space-y-2">{notifications?.map(item => <div className="rounded-2xl bg-sky-50 p-4" key={item.id}><b className="text-sm">{item.title}</b><p className="mt-1 text-sm text-slate-600">{item.body}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('ru-RU')}</p></div>)}</div></div>}
      <form action={signOut} className="mt-8">
        <button className="button w-full" type="submit">Выйти</button>
      </form>
    </section>
  </div>;
}
