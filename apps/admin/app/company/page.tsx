import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../lib/supabase/server';
import { decideMembership, saveReferralSettings } from './actions';
import { CopyCode } from './copy-code';

type Membership = { id:string; requested_at:string; profiles:{full_name?:string;phone?:string}|null };
export default async function CompanyHome() {
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect('/login');
  // Authorization is based on the verified auth user id. Load the matching
  // role and company server-side so an RLS/cache hiccup cannot incorrectly
  // send a valid company owner back to the public home page.
  const admin=createAdminClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  // Keep the account check compatible with databases where the optional bonus
  // columns have not been migrated yet. Selecting a missing optional column
  // makes PostgREST reject the whole company row and used to cause a login loop.
  const [{data:profile,error:profileError},{data:companyRow,error:companyError}]=await Promise.all([admin.from('profiles').select('full_name,role,status').eq('id',user.id).single(),admin.from('company_profiles').select('id,name,company_code,verification_status,service_cities').eq('owner_id',user.id).single()]);
  if(profileError||companyError||profile?.role!=='company_owner'||profile.status!=='active'||!companyRow) redirect('/login?error=company_account');
  const company={...companyRow,welcome_bonus_minor:0,referral_bonus_minor:0,referral_enabled:false};
  const [{count:clients},{count:referralClients},{count:orders},{data:ledger},{data:memberships}]=await Promise.all([
    supabase.from('company_code_uses').select('*',{count:'exact',head:true}).eq('company_id',company.id),
    supabase.from('company_code_uses').select('*',{count:'exact',head:true}).eq('company_id',company.id).eq('code_type','referral'),
    admin.from('orders').select('*',{count:'exact',head:true}).eq('selected_company_id',company.id),
    supabase.from('company_bonus_ledger').select('operation,amount_minor').eq('company_id',company.id),
    supabase.from('company_cleaners').select('id,requested_at,profiles!cleaner_id(full_name,phone)').eq('company_id',company.id).eq('membership_status','pending').order('requested_at'),
  ]);
  const issued=(ledger??[]).filter(x=>['welcome_grant','referral_grant'].includes(x.operation)).reduce((s,x)=>s+Number(x.amount_minor),0); const money=(n:number)=>`${(n/100).toLocaleString('ru-RU')} ₸`;
  return <div className="mx-auto max-w-5xl px-4 py-8"><h1 className="text-3xl font-black">{company.name}</h1><p className="mt-1 text-sm text-slate-500">{profile.full_name} · {company.verification_status}</p>
    <section className="card mt-6"><p className="text-xs font-bold uppercase text-emerald-700">Код компании</p><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><b className="text-3xl tracking-wider">{company.company_code}</b><CopyCode code={company.company_code}/></div><p className="mt-2 text-sm text-slate-500">Клиенты и клинеры вводят этот код при регистрации. Клинеры сначала попадают на подтверждение.</p></section>
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Клиентов',clients??0],['По рефералам',referralClients??0],['Всего заказов',orders??0],['Выдано бонусов',money(issued)]].map(([l,v])=><div className="card text-center" key={l}><b className="text-2xl">{v}</b><p className="text-xs text-slate-500">{l}</p></div>)}</div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><Link className="card block border-emerald-200 bg-emerald-50 font-black text-emerald-900" href="/company/orders">Заказы компании →</Link><Link className="card block border-emerald-200 bg-emerald-50 font-black text-emerald-900" href="/company/sales">Отдел продаж →</Link></div>
    <Link className="card mt-5 block font-black" href="/company/cities">Выбрать города работы →</Link>
    <Link className="card mt-3 block font-black" href="/company/employees">Управлять сотрудниками →</Link>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><form action={saveReferralSettings} className="card space-y-4"><h2 className="text-xl font-black">Бонусная программа</h2><label className="block text-sm font-semibold">Приветственный бонус, ₸<input className="input mt-1" name="welcome_bonus" type="number" min="0" max="10000" defaultValue={company.welcome_bonus_minor/100} required/></label><label className="block text-sm font-semibold">Бонус пригласившему, ₸<input className="input mt-1" name="referral_bonus" type="number" min="0" max="10000" defaultValue={company.referral_bonus_minor/100} required/></label><label className="flex gap-2 text-sm font-semibold"><input name="referral_enabled" type="checkbox" defaultChecked={company.referral_enabled}/> Реферальная программа включена</label><button className="button w-full">Сохранить</button></form>
    <section className="card"><h2 className="text-xl font-black">Заявки клинеров</h2><div className="mt-4 space-y-3">{(memberships as unknown as Membership[]|null)?.length?(memberships as unknown as Membership[]).map(m=><div className="rounded-2xl border p-4" key={m.id}><b>{m.profiles?.full_name??'Клинер'}</b><p className="text-sm text-slate-500">{m.profiles?.phone??'Телефон не указан'}</p><form action={decideMembership} className="mt-3 flex gap-2"><input type="hidden" name="membership_id" value={m.id}/><button className="button flex-1" name="decision" value="accept">Принять</button><button className="flex-1 rounded-xl border text-red-600" name="decision" value="reject">Отклонить</button></form></div>):<p className="text-sm text-slate-500">Новых заявок нет.</p>}</div></section></div>
  </div>;
}
