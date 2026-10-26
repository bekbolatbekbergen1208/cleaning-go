'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/client';

type Company = {
  id: string;
  name: string;
  description: string | null;
  service_cities: string[];
  rating: number;
  reviews_count: number;
  cashback_bps: number;
  welcome_bonus_minor: number;
};

export function CompanyChoice({ companies, preferredCompanyId, locked }: { companies: Company[]; preferredCompanyId: string | null; locked: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState(preferredCompanyId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (!selected || locked) return;
    setBusy(true);
    setMessage('');
    const { error } = await createClient().rpc('choose_company', { target_company_id: selected });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage('Компания выбрана. Она будет предложена при следующем заказе.');
      router.refresh();
    }
  }
  return <div className="mt-6 space-y-4">
    {locked && <p className="rounded-xl bg-amber-50 p-4 text-sm">Компания закреплена кодом приглашения. Сменить её нельзя.</p>}
    {!companies.length && <p className="card">Проверенных компаний пока нет.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{companies.map(company => <button key={company.id} type="button" disabled={locked} aria-pressed={selected === company.id} onClick={() => setSelected(company.id)} className={`rounded-2xl border-2 p-5 text-left ${selected === company.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <b className="text-lg">{company.name}</b>
      <p className="mt-1 text-sm text-slate-600">{company.service_cities.join(', ') || 'Город не указан'}</p>
      <p className="mt-2 text-sm font-semibold text-amber-700">★ {Number(company.rating).toFixed(1)} · {company.reviews_count} отзывов</p>
      {company.description && <p className="mt-2 text-sm">{company.description}</p>}
      <p className="mt-2 text-xs text-emerald-800">Кешбэк {Number(company.cashback_bps) / 100}% · приветственный бонус {(Number(company.welcome_bonus_minor) / 100).toLocaleString('ru-RU')} ₸</p>
      {selected === company.id && <span className="mt-2 inline-block text-xs font-bold text-emerald-700">Выбрано</span>}
    </button>)}</div>
    {message && <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className="button" disabled={busy || locked || !selected} onClick={save}>{busy ? 'Сохраняем…' : 'Подтвердить выбор'}</button><Link href="/order/new" className="rounded-xl border px-4 py-3 font-bold">Новый заказ</Link></div>
  </div>;
}
