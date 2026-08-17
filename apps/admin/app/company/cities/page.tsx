import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/server';

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
    const cities = [...new Set(String(formData.get('cities') ?? '').split(',').map((city) => city.trim()).filter((city) => city.length >= 2))].slice(0, 20);
    if (!cities.length) return;
    const { error } = await server.from('company_profiles').update({ service_cities: cities }).eq('owner_id', currentUser.id);
    if (error) throw new Error(error.message);
    revalidatePath('/company/cities'); revalidatePath('/company');
  }

  return <div className="mx-auto max-w-2xl px-4 py-10"><Link className="text-sm font-bold text-emerald-700" href="/company">← Кабинет компании</Link><form action={saveCities} className="card mt-5 space-y-4"><h1 className="text-3xl font-black">Города работы</h1><p className="text-sm text-slate-500">Введите один или несколько городов через запятую.</p><input className="input" name="cities" defaultValue={(company.service_cities ?? []).join(', ')} placeholder="Актау, Алматы, Астана" required/><button className="button w-full">Сохранить города</button></form></div>;
}
