import { requireAdmin } from '../../lib/require-admin';
import { verifyCompany } from '../verifications/actions';

const statusLabels: Record<string, string> = {
  pending: 'Ожидает проверки',
  approved: 'Одобрена',
  rejected: 'Отклонена',
  blocked: 'Заблокирована',
};

export default async function Companies() {
  const db = await requireAdmin();
  const { data } = await db
    .from('company_profiles')
    .select('id,name,registration_number,company_code,contact_phone,contact_email,verification_status,service_cities,created_at')
    .order('created_at', { ascending: false });

  return <>
    <h1 className="mb-6 text-3xl font-black">Компании</h1>
    <div className="space-y-3">{data?.length ? data.map(company => <article className="card" key={company.id}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black">{company.name}</h2>
          <p className="mt-1 text-sm text-slate-500">БИН: {company.registration_number ?? '—'} · Код: {company.company_code}</p>
          <p className="mt-1 text-sm text-slate-500">{company.contact_phone ?? company.contact_email ?? 'Контакт не указан'} · {(company.service_cities ?? []).join(', ') || 'Города не указаны'}</p>
        </div>
        <div className="flex flex-col items-end gap-2"><span className={`rounded-full px-3 py-1 text-sm font-bold ${company.verification_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{statusLabels[company.verification_status] ?? company.verification_status}</span>
          {company.verification_status === 'pending' && <div className="flex gap-2"><form action={verifyCompany.bind(null,'approved')}><input type="hidden" name="id" value={company.id}/><button className="button">Подтвердить</button></form><form action={verifyCompany.bind(null,'rejected')}><input type="hidden" name="id" value={company.id}/><button className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">Отклонить</button></form></div>}
        </div>
      </div>
    </article>) : <p className="card text-slate-500">Компаний пока нет.</p>}</div>
  </>;
}
