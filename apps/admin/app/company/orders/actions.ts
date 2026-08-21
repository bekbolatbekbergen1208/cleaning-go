'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

export async function proposeCompanyPrice(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const totalMinor = Math.round(Number(formData.get('total_kzt')) * 100);
  const requiredWorkers = Number(formData.get('required_workers'));
  const cleanerAmountMinor = Math.round(Number(formData.get('cleaner_amount_kzt')) * 100);
  if (!orderId || !Number.isFinite(totalMinor) || totalMinor < 10000) throw new Error('Укажите цену от 100 ₸');
  if (!Number.isInteger(requiredWorkers) || requiredWorkers < 1 || requiredWorkers > 50) throw new Error('Укажите количество клинеров от 1 до 50');
  if (!Number.isFinite(cleanerAmountMinor) || cleanerAmountMinor < 0) throw new Error('Укажите выплату клинерам');
  if (cleanerAmountMinor > totalMinor) throw new Error('Выплата клинерам не может превышать цену заказа');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const { data: company } = await supabase.from('company_profiles').select('id').eq('owner_id', user.id).single();
  if (!company) throw new Error('Компания не найдена');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order } = await admin.from('orders').select('id,client_id,status,price_confirmed_at').eq('id', orderId).eq('selected_company_id', company.id).in('status', ['searching', 'offered']).maybeSingle();
  if (!order || order.price_confirmed_at) throw new Error('Цена уже подтверждена клиентом');
  const { error: priceError } = await admin.from('orders').update({
    subtotal_minor: totalMinor,
    total_minor: totalMinor,
    required_workers: requiredWorkers,
    executor_amount_minor: cleanerAmountMinor,
    status: 'offered',
    price_confirmed_at: null,
    price_confirmed_by: null,
  }).eq('id', orderId).eq('selected_company_id', company.id);
  if (priceError) throw new Error(priceError.message);
  await admin.from('order_items').update({ unit_price_minor: totalMinor, total_minor: totalMinor }).eq('order_id', orderId).is('service_option_id', null);
  await admin.from('notifications').insert({
    user_id: order.client_id,
    order_id: order.id,
    type: 'company_price',
    title: 'Компания указала цену',
    body: `Цена заказа: ${(totalMinor / 100).toLocaleString('ru-RU')} ₸. После вашего подтверждения заказ будет опубликован для клинеров.`,
    data: { total_minor: totalMinor, required_workers: requiredWorkers, executor_amount_minor: cleanerAmountMinor },
  });
  revalidatePath('/company/orders');
  revalidatePath('/profile');
}

export async function publishCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const requiredWorkers = Number(formData.get('required_workers'));
  const cleanerAmountMinor = Math.round(Number(formData.get('cleaner_amount_kzt')) * 100);
  if (!orderId || !Number.isInteger(requiredWorkers) || requiredWorkers < 1 || requiredWorkers > 50) throw new Error('Укажите количество сотрудников от 1 до 50');
  if (!Number.isFinite(cleanerAmountMinor) || cleanerAmountMinor < 0) throw new Error('Укажите выплату клинерам');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const { data: company } = await supabase.from('company_profiles').select('id').eq('owner_id', user.id).single();
  if (!company) throw new Error('Компания не найдена');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await admin.from('orders').select('id,total_minor,price_confirmed_at').eq('id', orderId).eq('selected_company_id', company.id).eq('status', 'offered').maybeSingle();
  if (!order?.price_confirmed_at) throw new Error('Сначала клиент должен подтвердить цену');
  if (cleanerAmountMinor > Number(order.total_minor)) throw new Error('Выплата клинерам не может превышать цену заказа');
  const { error: setupError } = await admin.from('orders').update({ required_workers: requiredWorkers, executor_amount_minor: cleanerAmountMinor }).eq('id', orderId).eq('selected_company_id', company.id);
  if (setupError) throw new Error(setupError.message);
  const { error: acceptError } = await supabase.rpc('accept_order', {
    target_order_id: orderId,
    target_company_id: company.id,
  });
  if (acceptError) throw new Error(acceptError.message);

  revalidatePath('/company');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}

export async function updatePublishedOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const requiredWorkers = Number(formData.get('required_workers'));
  const cleanerAmountMinor = Math.round(Number(formData.get('cleaner_amount_kzt')) * 100);
  if (!orderId || !Number.isInteger(requiredWorkers) || requiredWorkers < 1 || requiredWorkers > 50) throw new Error('Укажите количество сотрудников от 1 до 50');
  if (!Number.isFinite(cleanerAmountMinor) || cleanerAmountMinor < 0) throw new Error('Укажите выплату клинерам');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const { data: company } = await supabase.from('company_profiles').select('id').eq('owner_id', user.id).single();
  if (!company) throw new Error('Компания не найдена');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await admin.from('orders').select('id,total_minor').eq('id', orderId).eq('selected_company_id', company.id).eq('status', 'accepted').maybeSingle();
  if (!order) throw new Error('Опубликованный заказ не найден');
  if (cleanerAmountMinor > Number(order.total_minor)) throw new Error('Выплата клинерам не может превышать цену заказа');

  const { count: occupiedWorkers } = await admin.from('order_workers').select('cleaner_id', { count: 'exact', head: true }).eq('order_id', orderId);
  if (requiredWorkers < (occupiedWorkers ?? 0)) throw new Error(`Уже назначено клинеров: ${occupiedWorkers}`);

  const { error } = await admin.from('orders').update({
    required_workers: requiredWorkers,
    executor_amount_minor: cleanerAmountMinor,
  }).eq('id', orderId).eq('selected_company_id', company.id).eq('status', 'accepted');
  if (error) throw new Error(error.message);

  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}
