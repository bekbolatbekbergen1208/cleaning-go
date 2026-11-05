'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { selectClientCompany } from './actions';

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

export function CompanyChoice({ companies, preferredCompanyId, locked, initialCity }: { initialCity: string; companies: Company[]; preferredCompanyId: string | null; locked: boolean }) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity);
  const cities = [...new Set([initialCity, 'Астана', 'Алматы', 'Шымкент', 'Актау', 'Атырау', ...companies.flatMap(company => company.service_cities)].map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const visibleCompanies = locked ? companies.filter(company => company.id === preferredCompanyId) : companies.filter(company => city.trim() && company.service_cities.some(value => value.trim().toLowerCase() === city.trim().toLowerCase()));
  const [selected, setSelected] = useState(preferredCompanyId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (!selected || locked || !visibleCompanies.some(company => company.id === selected)) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await selectClientCompany(selected, city);
      if (error) setMessage(error);
      else { router.push('/profile'); router.refresh(); }
    } catch { setMessage('Не удалось сохранить выбор. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  }

  return <div className="mt-6 space-y-4">
    {locked && <p className="rounded-xl bg-amber-50 p-4 text-sm">Компания закреплена кодом приглашения. Сменить её нельзя.</p>}
    {!locked && <label className="field-label block">Ваш город
      <input className="input mt-2" list="company-cities" placeholder="Например, Алматы" value={city} maxLength={80} disabled={busy} onChange={event => { setCity(event.target.value); setSelected(''); setMessage(''); }} />
      <datalist id="company-cities">{cities.map(value => <option key={value} value={value} />)}</datalist>
    </label>}
    {!locked && !city.trim() && <p className="card">Укажите город, чтобы увидеть доступные клининговые компании.</p>}
    {!visibleCompanies.length && (city.trim() || locked) && <p className="card">{locked ? 'Закреплённая компания сейчас недоступна. Обратитесь в поддержку.' : 'В этом городе пока нет проверенных компаний. Можно выбрать другой город.'}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{visibleCompanies.map(company => <button key={company.id} type="button" disabled={locked || busy} aria-pressed={selected === company.id} onClick={() => setSelected(company.id)} className={`rounded-2xl border-2 p-5 text-left ${selected === company.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <b className="text-lg">{company.name}</b>
      <p className="mt-1 text-sm text-slate-600">{company.service_cities.join(', ') || 'Город не указан'}</p>
      <p className="mt-2 text-sm font-semibold text-amber-700">★ {Number(company.rating).toFixed(1)} · {company.reviews_count} отзывов</p>
      {company.description && <p className="mt-2 text-sm">{company.description}</p>}
      <p className="mt-2 text-xs text-emerald-800">Кешбэк {Number(company.cashback_bps) / 100}% · приветственный бонус {(Number(company.welcome_bonus_minor) / 100).toLocaleString('ru-RU')} ₸</p>
      {selected === company.id && <span className="mt-2 inline-block text-xs font-bold text-emerald-700">Выбрано</span>}
    </button>)}</div>
    {message && <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className="button" disabled={busy || locked || !visibleCompanies.some(company => company.id === selected)} onClick={save}>{busy ? 'Сохраняем…' : 'Подтвердить выбор'}</button>{preferredCompanyId && <Link href="/order/new" className="rounded-xl border px-4 py-3 font-bold">Новый заказ</Link>}</div>
  </div>;
}
