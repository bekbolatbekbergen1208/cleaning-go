'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/backend/server';

export async function selectClientCompany(companyId: string, city: string) {
  const selectedCity = city.trim();
  if (selectedCity.length < 2 || selectedCity.length > 80) return { error: 'Укажите свой город.' };
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();
  if (!user) return { error: 'Сначала войдите в аккаунт.' };
  const [{ data: profile, error: profileError }, { data: client, error: clientError }, { data: company, error: companyError }] = await Promise.all([
    backend.from('profiles').select('role,status').eq('id', user.id).single(),
    backend.from('client_profiles').select('company_locked').eq('user_id', user.id).single(),
    backend.from('company_profiles').select('service_cities').eq('id', companyId).eq('verification_status', 'approved').single(),
  ]);
  if (profileError || clientError || companyError) return { error: 'Не удалось проверить компанию. Обновите страницу.' };
  if (profile?.role !== 'client' || profile.status !== 'active') return { error: 'Выбор доступен только активному клиенту.' };
  if (client?.company_locked) return { error: 'Компания уже закреплена специальным кодом.' };
  if (!company?.service_cities?.some((value: string) => value.trim().toLowerCase() === selectedCity.toLowerCase())) return { error: 'Компания не обслуживает выбранный город.' };
  const { error: cityError } = await backend.from('profiles').update({ city: selectedCity }).eq('id', user.id);
  if (cityError) return { error: 'Не удалось сохранить город. Попробуйте ещё раз.' };
  const { error } = await backend.rpc('choose_company', { target_company_id: companyId });
  if (error) return { error: error.message };
  revalidatePath('/profile');
  revalidatePath('/profile/company');
  revalidatePath('/order/new');
  return { error: null };
}
