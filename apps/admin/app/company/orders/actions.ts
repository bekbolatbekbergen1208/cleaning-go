'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createAdminClient } from '@cleaning-go/local-client';
import { createClient } from '../../../lib/backend/server';

export async function proposeCompanyPrice(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const totalMinor = Math.round(Number(formData.get('total_kzt')) * 100);
  const requiredWorkers = Number(formData.get('required_workers'));
  const cleanerAmountMinor = Math.round(
    Number(formData.get('cleaner_amount_kzt')) * 100,
  );
  if (!orderId || !Number.isFinite(totalMinor) || totalMinor < 10000)
    throw new Error('Укажите цену от 100 ₸');
  if (
    !Number.isInteger(requiredWorkers) ||
    requiredWorkers < 1 ||
    requiredWorkers > 50
  )
    throw new Error('Укажите количество клинеров от 1 до 50');
  if (
    !Number.isFinite(cleanerAmountMinor) ||
    cleanerAmountMinor < requiredWorkers * 100
  )
    throw new Error('Укажите выплату не менее 1 ₸ каждому клинеру');
  if (cleanerAmountMinor > totalMinor)
    throw new Error('Выплата клинерам не может превышать цену заказа');

  const backend = await createClient();
  const { error } = await backend.rpc('propose_company_order_price', {
    target_order_id: orderId,
    target_total_minor: totalMinor,
    target_required_workers: requiredWorkers,
    target_cleaner_amount_minor: cleanerAmountMinor,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/company/orders');
  revalidatePath('/profile');
}

export async function publishCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const requiredWorkers = Number(formData.get('required_workers'));
  const cleanerAmountMinor = Math.round(
    Number(formData.get('cleaner_amount_kzt')) * 100,
  );
  if (
    !orderId ||
    !Number.isInteger(requiredWorkers) ||
    requiredWorkers < 1 ||
    requiredWorkers > 50
  )
    throw new Error('Укажите количество сотрудников от 1 до 50');
  if (
    !Number.isFinite(cleanerAmountMinor) ||
    cleanerAmountMinor < requiredWorkers * 100
  )
    throw new Error('Укажите выплату не менее 1 ₸ каждому клинеру');

  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const { data: company } = await backend
    .from('company_profiles')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (!company) throw new Error('Компания не найдена');
  const admin = createAdminClient(
    process.env.LOCAL_API_URL || 'http://127.0.0.1:54321',
    process.env.LOCAL_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: order } = await admin
    .from('orders')
    .select('id,total_minor,price_confirmed_at')
    .eq('id', orderId)
    .eq('selected_company_id', company.id)
    .eq('status', 'offered')
    .maybeSingle();
  if (!order?.price_confirmed_at)
    throw new Error('Сначала клиент должен подтвердить цену');
  if (cleanerAmountMinor > Number(order.total_minor))
    throw new Error('Выплата клинерам не может превышать цену заказа');
  const { error: setupError } = await admin
    .from('orders')
    .update({
      required_workers: requiredWorkers,
      executor_amount_minor: cleanerAmountMinor,
    })
    .eq('id', orderId)
    .eq('selected_company_id', company.id);
  if (setupError) throw new Error(setupError.message);
  const { error: acceptError } = await backend.rpc('accept_order', {
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
  const cleanerAmountMinor = Math.round(
    Number(formData.get('cleaner_amount_kzt')) * 100,
  );
  if (
    !orderId ||
    !Number.isInteger(requiredWorkers) ||
    requiredWorkers < 1 ||
    requiredWorkers > 50
  )
    throw new Error('Укажите количество сотрудников от 1 до 50');
  if (
    !Number.isFinite(cleanerAmountMinor) ||
    cleanerAmountMinor < requiredWorkers * 100
  )
    throw new Error('Укажите выплату не менее 1 ₸ каждому клинеру');

  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const admin = createAdminClient(
    process.env.LOCAL_API_URL || 'http://127.0.0.1:54321',
    process.env.LOCAL_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: company, error: companyError } = await admin
    .from('company_profiles')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (companyError) throw new Error(companyError.message);
  if (!company) throw new Error('Компания не найдена');

  const { data: order } = await admin
    .from('orders')
    .select('id,total_minor')
    .eq('id', orderId)
    .eq('selected_company_id', company.id)
    .eq('status', 'accepted')
    .maybeSingle();
  if (!order) throw new Error('Опубликованный заказ не найден');
  if (cleanerAmountMinor > Number(order.total_minor))
    throw new Error('Выплата клинерам не может превышать цену заказа');

  const { count: occupiedWorkers } = await admin
    .from('order_workers')
    .select('cleaner_id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  if (requiredWorkers < (occupiedWorkers ?? 0))
    throw new Error(`Уже назначено клинеров: ${occupiedWorkers}`);

  const { data: updatedOrder, error } = await admin
    .from('orders')
    .update({
      required_workers: requiredWorkers,
      executor_amount_minor: cleanerAmountMinor,
    })
    .eq('id', orderId)
    .eq('selected_company_id', company.id)
    .eq('status', 'accepted')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updatedOrder)
    throw new Error(
      'Заказ уже изменился. Обновите страницу и повторите попытку',
    );

  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}
