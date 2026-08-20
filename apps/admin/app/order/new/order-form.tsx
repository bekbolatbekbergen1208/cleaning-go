'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/client';

type Service = { id: string; name: string; description: string | null; base_price_minor: number };
type Company = { id: string; name: string; rating: number; reviews_count: number; service_cities: string[]; verification_status: 'pending' | 'approved' | 'rejected' | 'blocked' };

export function OrderForm({ services, companies, preferredCompanyId, companyLocked, bonusBalances }: {
  services: Service[];
  companies: Company[];
  preferredCompanyId: string | null;
  companyLocked: boolean;
  bonusBalances?: Record<string, number>;
}) {
  const router = useRouter();
  const approvedCompanies = companies.filter((company) => company.verification_status === 'approved');
  const cityOptions = [...new Set(approvedCompanies.flatMap((company) => company.service_cities).map((item) => item.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [city, setCity] = useState(cityOptions.includes('Актау') ? 'Актау' : cityOptions[0] ?? 'Актау');
  const [companyId, setCompanyId] = useState(preferredCompanyId ?? approvedCompanies[0]?.id ?? '');
  const [bonusKzt, setBonusKzt] = useState(0);
  const availableCompanies = companyLocked
    ? approvedCompanies.filter((company) => company.id === preferredCompanyId)
    : approvedCompanies.filter((company) => company.service_cities.some((item) => item.trim().toLowerCase() === city.trim().toLowerCase()));
  const selectedCompanyId = availableCompanies.some((company) => company.id === companyId) ? companyId : availableCompanies[0]?.id ?? '';
  const lockedCompany = companyLocked ? availableCompanies[0] : undefined;
  const unavailableLockedCompany = companyLocked ? companies.find((company) => company.id === preferredCompanyId && company.verification_status !== 'approved') : undefined;
  const availableBonusMinor = bonusBalances?.[selectedCompanyId] ?? 0;
  const selectedService = services.find((service) => service.id === serviceId);
  const estimatedPrice = (selectedService?.base_price_minor ?? 0) / 100;

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
    const orderFunction = requestedBonusMinor > 0 ? 'create_order_with_bonus' : 'create_order';
    const { data: order, error: orderError } = await supabase.rpc(orderFunction, { payload: {
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

  return <form className="card mt-6 space-y-6 sm:p-7" onSubmit={submit}>
    <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold"><span className="rounded-xl bg-emerald-600 px-2 py-3 text-white">1. Адрес</span><span className="rounded-xl bg-emerald-50 px-2 py-3 text-emerald-800">2. Компания</span><span className="rounded-xl bg-emerald-50 px-2 py-3 text-emerald-800">3. Детали</span></div>
    <div className="rounded-2xl bg-slate-50 p-4 sm:p-5"><p className="mb-4 text-lg font-black">Что и где убрать</p>
    <label className="block"><span className="text-sm font-semibold">Вид уборки</span><select className="input mt-1" name="service_id" value={serviceId} onChange={(event)=>setServiceId(event.target.value)} required>{services.map((service) => <option key={service.id} value={service.id}>{service.name} — от {(service.base_price_minor/100).toLocaleString('ru-RU')} ₸</option>)}</select></label>
    {selectedService&&<div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Примерная стоимость</p><p className="mt-1 text-2xl font-black text-emerald-900">от {estimatedPrice.toLocaleString('ru-RU')} ₸</p>{selectedService.description&&<p className="mt-1 text-sm text-emerald-800">{selectedService.description}</p>}<p className="mt-2 text-xs text-slate-500">Это ориентир. Компания подтвердит точную цену после просмотра фото, площади и деталей заказа.</p></div>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-semibold">Город</span><select className="input mt-1" name="city" value={city} onChange={(event) => setCity(event.target.value)} required>{cityOptions.map(item=><option key={item}>{item}</option>)}</select></label><label><span className="text-sm font-semibold">Адрес</span><input className="input mt-1" name="address" placeholder="Улица, дом, квартира" required /></label></div></div>
    <section><h2 className="text-lg font-black">Кто выполнит уборку</h2>{companyLocked ? lockedCompany ? <div className="mt-2 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4"><b className="text-lg">{lockedCompany.name}</b><p className="mt-1 text-sm text-emerald-800">★ {Number(lockedCompany.rating).toFixed(1)} · {lockedCompany.reviews_count} отзывов</p><p className="mt-2 text-xs text-slate-500">Закреплена специальным кодом. Заказ автоматически отправится этой компании.</p></div> : <div className="mt-2 rounded-2xl bg-red-50 p-4 text-sm text-red-700"><b>{unavailableLockedCompany?.name ?? 'Закреплённая компания'}</b><p className="mt-1">{unavailableLockedCompany ? `Текущий статус: ${unavailableLockedCompany.verification_status}. Администратор должен одобрить компанию.` : 'Данные компании недоступны. Обратитесь к администратору.'}</p></div> : <><p className="mt-1 text-xs text-slate-500">Компании в городе «{city}» отсортированы по рейтингу.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{availableCompanies.map(company=><button type="button" key={company.id} onClick={()=>setCompanyId(company.id)} className={`rounded-2xl border-2 p-4 text-left transition ${selectedCompanyId===company.id?'border-emerald-500 bg-emerald-50 shadow-sm':'border-slate-200 bg-white hover:border-emerald-200'}`}><div className="flex items-start justify-between gap-2"><b className="block text-lg">{company.name}</b>{selectedCompanyId===company.id&&<span className="rounded-full bg-emerald-600 px-2 py-1 text-xs text-white">Выбрано</span>}</div><span className="mt-2 block text-sm font-bold text-amber-600">★ {Number(company.rating).toFixed(1)}</span><span className="text-xs text-slate-500">{company.reviews_count} отзывов</span></button>)}</div>{!availableCompanies.length&&<p className="mt-2 rounded-xl bg-red-50 p-3 font-semibold text-red-600">В этом городе пока нет доступных компаний.</p>}</>}</section>
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
