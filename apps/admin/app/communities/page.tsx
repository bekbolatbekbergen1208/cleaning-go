import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/require-admin';
import { createCommunity, deleteCommunity, toggleCommunity } from './actions';
import { DeleteCommunityButton } from './delete-community-button';

export default async function CommunitiesPage() {
  await requireAdmin();
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .from('cleaner_communities')
    .select('id,name,code,description,is_active,created_at,community_companies(count),community_cleaners(count)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Не удалось загрузить сообщества: ${error.message}`);

  return <>
    <h1 className="text-3xl font-black">Сообщества клинеров</h1>
    <p className="mt-2 text-slate-500">Создайте сообщество и передайте его код компаниям и клинерам.</p>
    <form action={createCommunity} className="card mt-6 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">Название<input className="input mt-1" name="name" required minLength={2}/></label>
      <label className="text-sm font-bold">Описание<input className="input mt-1" name="description"/></label>
      <button className="button sm:col-span-2">Создать сообщество</button>
    </form>
    <div className="mt-6 space-y-3">
      {data.length ? data.map((item) => {
        const companies = (item.community_companies as unknown as {count:number}[])?.[0]?.count ?? 0;
        const cleaners = (item.community_cleaners as unknown as {count:number}[])?.[0]?.count ?? 0;
        return <article className="card" key={item.id}>
          <div className="flex flex-wrap justify-between gap-4">
            <div><h2 className="text-xl font-black">{item.name}</h2><p className="text-sm text-slate-500">{item.description || 'Без описания'}</p><p className="mt-3 text-sm">Компаний: <b>{companies}</b> · Клинеров: <b>{cleaners}</b></p></div>
            <div className="text-right">
              <p className="rounded-xl bg-emerald-50 px-4 py-2 font-mono text-xl font-black text-emerald-800">{item.code}</p>
              <div className="mt-3 flex justify-end gap-4">
                <form action={toggleCommunity}><input type="hidden" name="id" value={item.id}/><input type="hidden" name="active" value={item.is_active ? 'false' : 'true'}/><button className="text-sm font-bold">{item.is_active ? 'Отключить' : 'Включить'}</button></form>
                <form action={deleteCommunity}><input type="hidden" name="id" value={item.id}/><DeleteCommunityButton name={item.name}/></form>
              </div>
            </div>
          </div>
        </article>;
      }) : <p className="card text-slate-500">Сообществ пока нет.</p>}
    </div>
  </>;
}
