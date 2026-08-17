import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/server';

const kazakhstanCities = [
  'Абай','Акколь','Аксай','Аксу','Актау','Актобе','Алга','Алматы','Алтай','Арал','Аркалык','Арыс','Астана','Атбасар','Атырау','Аягоз',
  'Балхаш','Булаево','Державинск','Ерейментау','Есик','Есиль','Жанаозен','Жанатас','Жаркент','Жезказган','Жем','Житикара','Зайсан',
  'Кандыагаш','Караганда','Каражал','Каратау','Каркаралинск','Каскелен','Кентау','Кокшетау','Конаев','Костанай','Косшы','Кульсары','Курчатов','Кызылорда',
  'Ленгер','Лисаковск','Макинск','Мамлютка','Павлодар','Петропавловск','Приозёрск','Риддер','Рудный','Сарань','Сарканд','Сарыагаш','Сатпаев','Семей',
  'Сергеевка','Серебрянск','Степногорск','Степняк','Тайынша','Талгар','Талдыкорган','Тараз','Текели','Темир','Темиртау','Тобыл','Туркестан','Уральск',
  'Усть-Каменогорск','Ушарал','Уштобе','Форт-Шевченко','Хромтау','Шалкар','Шардара','Шахтинск','Шемонаиха','Шу','Шымкент','Щучинск','Экибастуз',
];

export default async function CompanyCitiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: company } = await supabase.from('company_profiles').select('id,name,service_cities').eq('owner_id', user.id).maybeSingle();
  if (!company) redirect('/');

  async function saveCities(formData: FormData) {
    'use server';
    const server = await createClient();
    const { data: { user: currentUser } } = await server.auth.getUser();
    if (!currentUser) redirect('/login');
    const cities = [...new Set(formData.getAll('cities').map(String).filter((city) => kazakhstanCities.includes(city)))];
    if (!cities.length) return;
    const { error } = await server.from('company_profiles').update({ service_cities: cities }).eq('owner_id', currentUser.id);
    if (error) throw new Error(error.message);
    revalidatePath('/company/cities'); revalidatePath('/company');
  }

  const selected = new Set(company.service_cities ?? []);
  return <div className="mx-auto max-w-4xl px-4 py-10"><Link className="text-sm font-bold text-emerald-700" href="/company">← Кабинет компании</Link><form action={saveCities} className="card mt-5"><h1 className="text-3xl font-black">Города работы</h1><p className="mt-2 text-sm text-slate-500">Отметьте все города, где компания принимает заказы.</p><div className="mt-6 grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-2 sm:grid-cols-3 lg:grid-cols-4">{kazakhstanCities.map(city=><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-semibold hover:bg-emerald-50" key={city}><input type="checkbox" name="cities" value={city} defaultChecked={selected.has(city)}/><span>{city}</span></label>)}</div><button className="button mt-6 w-full">Сохранить выбранные города</button></form></div>;
}
