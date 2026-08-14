import { createClient as createAdminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';

type ClientRow = {
  user_id: string;
  created_at: string;
  profiles: { full_name: string; email: string | null; phone: string | null; status: string } | null;
};

export default async function CompanySales() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('company_profiles').select('id,name,company_code').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner' || !company) redirect('/');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .from('client_profiles')
    .select('user_id,created_at,profiles!user_id(full_name,email,phone,status)')
    .eq('preferred_company_id', company.id)
    .order('created_at', { ascending: false });
  const clients = (data ?? []) as unknown as ClientRow[];

  return <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-bold text-emerald-700">{company.name}</p><h1 className="mt-1 text-3xl font-black">Отдел продаж</h1><p className="mt-2 text-slate-500">Клиенты, закреплённые по коду <b>{company.company_code}</b>.</p></div>
      <div className="rounded-2xl bg-emerald-50 px-5 py-3 text-center"><b className="block text-2xl text-emerald-800">{clients.length}</b><span className="text-xs text-emerald-700">клиентов</span></div>
    </div>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить клиентов: {error.message}</p> : clients.length ? <div className="mt-6 space-y-3">{clients.map((client) => <article className="card flex items-center gap-4" key={client.user_id}>
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg font-black text-emerald-800">{(client.profiles?.full_name ?? 'К').slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0 flex-1"><h2 className="truncate font-black">{client.profiles?.full_name ?? 'Клиент'}</h2><p className="truncate text-sm text-slate-500">{client.profiles?.phone ?? 'Телефон не указан'} · {client.profiles?.email ?? 'Email не указан'}</p><p className="mt-1 text-xs text-slate-400">Добавлен {new Date(client.created_at).toLocaleDateString('ru-KZ')}</p></div>
      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{client.profiles?.status ?? 'active'}</span>
    </article>)}</div> : <div className="card mt-6 text-center"><p className="text-lg font-black">Клиентов пока нет</p><p className="mt-2 text-sm text-slate-500">Передайте код компании клиенту. После регистрации он автоматически появится здесь.</p></div>}
  </div>;
}
