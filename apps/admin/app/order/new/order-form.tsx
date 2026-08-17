'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/client';

type Service = { id: string; name: string; description: string | null };
type Company = { id: string; name: string; rating: number; reviews_count: number; service_cities: string[] };

export function OrderForm({ services, companies, preferredCompanyId, companyLocked, bonusBalances }: {
  services: Service[];
  companies: Company[];
  preferredCompanyId: string | null;
  companyLocked: boolean;
  bonusBalances?: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [city, setCity] = useState('Актау');
  const [companyId, setCompanyId] = useState(preferredCompanyId ?? companies[0]?.id ?? '');
  const [bonusKzt, setBonusKzt] = useState(0);
  const availableCompanies = companyLocked
    ? companies.filter((company) => company.id === preferredCompanyId)
    : companies.filter((company) => company.service_cities.some((item) => item.trim().toLowerCase() === city.trim().toLowerCase()));
  const selectedCompanyId = availableCompanies.some((company) => company.id === companyId) ? companyId : availableCompanies[0]?.id ?? '';
  const lockedCompany = companyLocked ? availableCompanies[0] : undefined;
  const availableBonusMinor = bonusBalances?.[selectedCompanyId] ?? 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    setSuccess('');
    const form = new FormData(formElement);
    const photo = form.get('photo');
    const scheduledAt = new Date(String(form.get('scheduled_at')));
    if (!(photo instanceof File) || photo.size === 0) { setError('Добавьте фотографию помещения.'); setBusy(false); return; }
    if (scheduledAt <= new Date()) { setError('Выберите будущее время уборки.'); setBusy(false); return; }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    const photoPath = `${user.id}/${Date.now()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: photoError } = await supabase.storage.from('order-photos').upload(photoPath, photo, { contentType: photo.type, upsert: false });
    if (photoError) { setError(`Не удалось загрузить фото: ${photoError.message}`); setBusy(false); return; }

    const { data: address, error: addressError } = await supabase.from('addresses').insert({
      user_id: user.id,
      label: 'Заказ',
      city: String(form.get('city')).trim(),
      address_line: String(form.get('address')).trim(),
    }).select('id').single();
    if (addressError) { setError(`Не удалось сохранить адрес: ${addressError.message}`); setBusy(false); return; }

    const requestedBonusMinor = Math.round(Number(bonusKzt) * 100);
    if (requestedBonusMinor < 0 || requestedBonusMinor > availableBonusMinor) { setError('Указанная сумма превышает доступный бонус.'); setBusy(false); return; }
    const { data: order, error: orderError } = await supabase.rpc(bonusBalances ? 'create_order_with_bonus' : 'create_order', { payload: {
      address_id: address.id,
      service_id: String(form.get('service_id')),
      selected_company_id: selectedCompanyId,
      scheduled_at: scheduledAt.toISOString(),
      area_sq_m: Number(form.get('area_sq_m')),
      rooms_count: Number(form.get('rooms_count')),
      comment: String(form.get('comment') ?? '').trim(),
      executor_preference: 'company',
      payment_method: 'cash',
      option_ids: [],
      photo_urls: [photoPath],
      bonus_amount_minor: requestedBonusMinor,
    } });
    if (orderError) { setError(`Не удалось создать заказ: ${orderError.message}`); setBusy(false); return; }
    setSuccess(`Заказ ${order.order_number} создан. Компания скоро подтвердит цену.`);
    setBusy(false);
    formElement.reset();
  }

  return <form className="card mt-6 space-y-4" onSubmit={submit}>
    <label className="block"><span className="text-sm font-semibold">Вид уборки</span><select className="input mt-1" name="service_id" required>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-semibold">Город</span><input className="input mt-1" name="city" value={city} onChange={(event) => setCity(event.target.value)} required /></label><label><span className="text-sm font-semibold">Адрес</span><input className="input mt-1" name="address" required /></label></div>
    <section><span className="text-sm font-semibold">Клининговая компания</span>{companyLocked ? lockedCompany ? <div className="mt-2 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4"><b className="text-lg">{lockedCompany.name}</b><p className="mt-1 text-sm text-emerald-800">★ {Number(lockedCompany.rating).toFixed(1)} · {lockedCompany.reviews_count} отзывов</p><p className="mt-2 text-xs text-slate-500">Закреплена специальным кодом. Заказ автоматически отправится этой компании.</p></div> : <p className="mt-2 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-600">Закреплённая компания пока не одобрена или недоступна. Заказ временно невозможен.</p> : <><p className="mt-1 text-xs text-slate-500">Компании, которые работают в городе «{city}». Выберите по рейтингу и отзывам.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{availableCompanies.map(company=><button type="button" key={company.id} onClick={()=>setCompanyId(company.id)} className={`rounded-2xl border-2 p-4 text-left transition ${selectedCompanyId===company.id?'border-emerald-500 bg-emerald-50':'border-slate-200 bg-white hover:border-emerald-200'}`}><b className="block text-lg">{company.name}</b><span className="mt-1 block text-sm text-amber-600">★ {Number(company.rating).toFixed(1)}</span><span className="text-xs text-slate-500">{company.reviews_count} отзывов</span></button>)}</div>{!availableCompanies.length&&<p className="mt-2 font-semibold text-red-600">В этом городе пока нет доступных компаний.</p>}</>}</section>
    {bonusBalances && <label className="block"><span className="text-sm font-semibold">Использовать бонусы</span><input className="input mt-1" type="number" min="0" max={availableBonusMinor / 100} step="1" value={bonusKzt} onChange={(event) => setBonusKzt(Number(event.target.value))} /><small className="mt-1 block text-slate-500">Доступно у выбранной компании: {(availableBonusMinor / 100).toLocaleString('ru-RU')} ₸. Списание произойдёт после подтверждения цены.</small></label>}
    <label className="block"><span className="text-sm font-semibold">Дата и время</span><input className="input mt-1" type="datetime-local" name="scheduled_at" required /></label>
    <div className="grid grid-cols-2 gap-4"><label><span className="text-sm font-semibold">Площадь, м²</span><input className="input mt-1" type="number" name="area_sq_m" min="1" defaultValue="50" required /></label><label><span className="text-sm font-semibold">Комнат</span><input className="input mt-1" type="number" name="rooms_count" min="1" defaultValue="2" required /></label></div>
    <label className="block"><span className="text-sm font-semibold">Фото помещения</span><input className="input mt-1" type="file" name="photo" accept="image/jpeg,image/png,image/webp" required /></label>
    <label className="block"><span className="text-sm font-semibold">Комментарий</span><textarea className="input mt-1" name="comment" rows={3} /></label>
    <p className="text-sm text-slate-500">Оплата наличными. Итоговую цену компания подтвердит после просмотра фотографии.</p>
    {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    {success && <p className="text-sm font-semibold text-emerald-700">{success}</p>}
    <button className="button w-full" disabled={busy || !services.length || !availableCompanies.length}>{busy ? 'Создаём заказ…' : 'Отправить заказ'}</button>
  </form>;
}
