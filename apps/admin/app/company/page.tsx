import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../lib/supabase/server';
import { decideMembership, saveReferralSettings } from './actions';
import { CopyCode } from './copy-code';

type Membership = { id:string; requested_at:string; profiles:{full_name?:string;phone?:string}|null };
export default async function CompanyHome({ searchParams }: { searchParams: Promise<{ referral_saved?: string; referral_error?: string }> }) {
  const params = await searchParams;
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect('/login');
  // Authorization is based on the verified auth user id. Load the matching
  // role and company server-side so an RLS/cache hiccup cannot incorrectly
  // send a valid company owner back to the public home page.
  const admin=createAdminClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  // Do not include optional bonus columns in the authorization query. Older
  // production schemas may not have them yet, and PostgREST would reject the
  // entire company row and incorrectly send a valid owner back to login.
  const [{data:profile,error:profileError},{data:companyRow,error:companyError}]=await Promise.all([admin.from('profiles').select('full_name,role,status').eq('id',user.id).single(),admin.from('company_profiles').select('id,name,company_code,verification_status,service_cities').eq('owner_id',user.id).single()]);
  if(profileError||companyError||profile?.role!=='company_owner'||profile.status!=='active'||!companyRow) redirect('/login?error=company_account');
  const {data:bonusSettings}=await admin.from('company_profiles').select('welcome_bonus_minor,referral_bonus_minor,referral_enabled').eq('id',companyRow.id).maybeSingle();
  const company={...companyRow,welcome_bonus_minor:Number(bonusSettings?.welcome_bonus_minor??0),referral_bonus_minor:Number(bonusSettings?.referral_bonus_minor??0),referral_enabled:Boolean(bonusSettings?.referral_enabled)};
  const [{count:clients},{count:referralClients},{count:orders},{data:completedOrders},{data:ledger},{data:memberships},{data:notifications}]=await Promise.all([
    supabase.from('company_code_uses').select('*',{count:'exact',head:true}).eq('company_id',company.id),
    supabase.from('company_code_uses').select('*',{count:'exact',head:true}).eq('company_id',company.id).eq('code_type','referral'),
    admin.from('orders').select('*',{count:'exact',head:true}).eq('selected_company_id',company.id),
    admin.from('orders').select('total_minor,executor_amount_minor').eq('selected_company_id',company.id).eq('status','completed'),
    supabase.from('company_bonus_ledger').select('operation,amount_minor').eq('company_id',company.id),
    supabase.from('company_cleaners').select('id,requested_at,profiles!cleaner_id(full_name,phone)').eq('company_id',company.id).eq('membership_status','pending').order('requested_at'),
    admin.from('notifications').select('id,title,body,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10),
  ]);
  const issued=(ledger??[]).filter(x=>['welcome_grant','referral_grant'].includes(x.operation)).reduce((s,x)=>s+Number(x.amount_minor),0);
  const netProfit=(completedOrders??[]).reduce((sum,order)=>sum+Math.max(0,Number(order.total_minor)-Number(order.executor_amount_minor)),0);
  const money=(n:number)=>`${(n/100).toLocaleString('ru-RU')} ₸`;
  return <div className="mx-auto max-w-5xl px-4 py-8"><h1 className="text-3xl font-black">{company.name}</h1><p className="mt-1 text-sm text-slate-500">{profile.full_name} · {company.verification_status}</p>
    <section className="card mt-6"><p className="text-xs font-bold uppercase text-emerald-700">Код компании</p><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><b className="text-3xl tracking-wider">{company.company_code}</b><CopyCode code={company.company_code}/></div><p className="mt-2 text-sm text-slate-500">Клиенты и клинеры вводят этот код при регистрации. Клинеры сначала попадают на подтверждение.</p></section>
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Клиентов',clients??0],['По рефералам',referralClients??0],['Всего заказов',orders??0],['Чистая прибыль',money(netProfit)],['Выдано бонусов',money(issued)]].map(([l,v])=><div className="card text-center" key={l}><b className="text-2xl">{v}</b><p className="text-xs text-slate-500">{l}</p></div>)}</div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><Link className="group rounded-2xl bg-emerald-700 p-5 text-white shadow-sm transition hover:bg-emerald-800" href="/company/orders"><span className="text-xs font-bold uppercase tracking-wider text-emerald-200">Основной раздел</span><span className="mt-2 flex items-center justify-between text-xl font-black"><span>Посмотреть заказы</span><span className="transition group-hover:translate-x-1">→</span></span><span className="mt-2 block text-sm font-medium text-emerald-100">Новые заявки, цены и текущие работы</span></Link><Link className="card block border-emerald-200 bg-emerald-50 font-black text-emerald-900" href="/company/sales">Отдел продаж →</Link></div>
    <Link className="card mt-5 block font-black" href="/company/cities">Выбрать города работы →</Link>
    <Link className="card mt-3 block font-black" href="/company/employees">Управлять сотрудниками →</Link>
    {Boolean(notifications?.length)&&<section className="card mt-5"><h2 className="text-xl font-black">Уведомления и новые запросы</h2><div className="mt-4 space-y-3">{notifications?.map(item=><div className="rounded-2xl bg-sky-50 p-4" key={item.id}><b>{item.title}</b><p className="mt-1 text-sm text-slate-600">{item.body}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('ru-RU')}</p></div>)}</div></section>}
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><form action={saveReferralSettings} className="card space-y-4"><h2 className="text-xl font-black">Бонусная программа</h2>{params.referral_saved==='1'&&<p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">Настройки сохранены.</p>}{params.referral_error&&<p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">Не удалось сохранить. Проверьте суммы и повторите.</p>}<label className="block text-sm font-semibold">Приветственный бонус, ₸<input className="input mt-1" name="welcome_bonus" type="number" min="0" max="10000" defaultValue={company.welcome_bonus_minor/100} required/></label><label className="block text-sm font-semibold">Бонус пригласившему, ₸<input className="input mt-1" name="referral_bonus" type="number" min="0" max="10000" defaultValue={company.referral_bonus_minor/100} required/></label><label className="flex gap-2 text-sm font-semibold"><input name="referral_enabled" type="checkbox" defaultChecked={company.referral_enabled}/> Реферальная программа включена</label><button className="button w-full">Сохранить</button></form>
    <section className="card"><h2 className="text-xl font-black">Заявки клинеров</h2><div className="mt-4 space-y-3">{(memberships as unknown as Membership[]|null)?.length?(memberships as unknown as Membership[]).map(m=><div className="rounded-2xl border p-4" key={m.id}><b>{m.profiles?.full_name??'Клинер'}</b><p className="text-sm text-slate-500">{m.profiles?.phone??'Телефон не указан'}</p><form action={decideMembership} className="mt-3 flex gap-2"><input type="hidden" name="membership_id" value={m.id}/><button className="button flex-1" name="decision" value="accept">Принять</button><button className="flex-1 rounded-xl border text-red-600" name="decision" value="reject">Отклонить</button></form></div>):<p className="text-sm text-slate-500">Новых заявок нет.</p>}</div></section></div>
  </div>;
}
