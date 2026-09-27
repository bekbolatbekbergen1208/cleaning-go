import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

type Member = { cleaner_id: string; profiles: { full_name: string; status: string } | null };

export default async function CompanyCleanersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role,status').eq('id', user.id).single();
  if (profile?.role !== 'company_owner' || profile.status !== 'active') redirect('/profile');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: company, error: companyError } = await admin.from('company_profiles').select('id').eq('owner_id', user.id).single();
  if (companyError || !company) throw new Error('Не удалось загрузить компанию');
  const { data: membership, error: membershipError } = await admin.from('community_companies')
    .select('community_id,cleaner_communities(name,code,is_active)').eq('company_id', company.id).maybeSingle();
  if (membershipError) throw new Error('Не удалось загрузить сообщество');
  const community = membership?.cleaner_communities as unknown as { name: string; code: string; is_active: boolean } | null;
  let members: Member[] = [];
  let cleaners: { user_id: string; verification_status: string; is_available: boolean }[] = [];
  if (membership) {
    const { data, error } = await admin.from('community_cleaners')
      .select('cleaner_id,profiles!cleaner_id(full_name,status)').eq('community_id', membership.community_id).order('joined_at');
    if (error) throw new Error('Не удалось загрузить клинеров сообщества');
    members = (data ?? []) as unknown as Member[];
    if (members.length) {
      const { data: details, error: detailsError } = await admin.from('cleaner_profiles')
        .select('user_id,verification_status,is_available').in('user_id', members.map(member => member.cleaner_id));
      if (detailsError) throw new Error('Не удалось загрузить статусы клинеров');
      cleaners = details ?? [];
    }
  }
  const byId = new Map(cleaners.map(cleaner => [cleaner.user_id, cleaner]));
  return <div className="mx-auto max-w-3xl px-4 py-10">
    <Link className="text-sm font-bold text-emerald-700" href="/company">← Кабинет компании</Link>
    <h1 className="mt-5 text-3xl font-black">Клинеры сообщества</h1>
    <p className="mt-2 text-sm text-slate-500">Клинеры общие для всех компаний вашего сообщества. Клиенты и их заказы остаются у своей компании.</p>
    {community ? <>
      <section className="card mt-6"><h2 className="text-xl font-black">{community.name}</h2>
        <p className="mt-2 text-sm">Код приглашения клинера: <b>{community.code}</b></p>
        <p className="mt-2 text-sm text-slate-500">Участников: {members.length}. Состав сообщества управляется на уровне платформы.</p>
        {!community.is_active && <p className="mt-3 text-amber-700">Сообщество отключено. Новые заказы недоступны для взятия.</p>}
      </section>
      <div className="mt-6 space-y-3">{members.length ? members.map(member => {
        const cleaner = byId.get(member.cleaner_id);
        const available = community.is_active && member.profiles?.status === 'active' && cleaner?.verification_status === 'approved' && cleaner.is_available;
        return <article className="card flex items-center justify-between gap-4" key={member.cleaner_id}>
          <h2 className="font-bold">{member.profiles?.full_name ?? 'Клинер'}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{available ? 'Доступен' : 'Недоступен'}</span>
        </article>;
      }) : <p className="card text-slate-500">Клинеров пока нет. Передайте клинеру код сообщества для регистрации.</p>}</div>
    </> : <section className="card mt-6"><p>Компания пока не состоит в сообществе. Получите код у администратора и введите его в кабинете компании.</p><Link href="/company" className="button mt-4">Вступить в сообщество</Link></section>}
  </div>;
}
