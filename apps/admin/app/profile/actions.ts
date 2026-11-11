'use server';

import { createClient as createAdminClient } from '@cleaning-go/local-client';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../lib/backend/server';

export async function confirmCompanyPrice(
  _previous: string,
  formData: FormData,
): Promise<string> {
  const orderId = String(formData.get('order_id') ?? '');
  const quoteVersion = Number(formData.get('quote_version'));
  if (!Number.isSafeInteger(quoteVersion) || quoteVersion < 1) return 'Обновите страницу и проверьте актуальную цену.';
  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user || !orderId) return 'Заказ не найден. Обновите страницу.';
  const { error } = await backend.rpc('confirm_company_order_price', {
    target_order_id: orderId, expected_quote_version: quoteVersion,
  });
  if (error) return error.message;
  revalidatePath('/profile');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
  return '';
}

export async function confirmOrderCompletion(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');
  const admin = createAdminClient(
    process.env.LOCAL_API_URL || 'http://127.0.0.1:54321',
    process.env.LOCAL_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: order } = await admin
    .from('orders')
    .select('id,selected_company_id')
    .eq('id', orderId)
    .eq('client_id', user.id)
    .eq('status', 'completed_by_cleaner')
    .maybeSingle();
  if (!order) throw new Error('Завершение заказа уже недоступно');
  const { error } = await backend.rpc('transition_order_status', {
    target_order_id: order.id,
    next_status: 'completed',
    note: 'Клиент подтвердил завершение',
  });
  if (error) throw new Error(error.message);
  const { data: company } = await admin
    .from('company_profiles')
    .select('owner_id')
    .eq('id', order.selected_company_id)
    .maybeSingle();
  const { data: workers } = await admin
    .from('order_workers')
    .select('cleaner_id')
    .eq('order_id', order.id);
  const recipients = [
    company?.owner_id,
    ...(workers ?? []).map((worker) => worker.cleaner_id),
  ].filter(Boolean) as string[];
  if (recipients.length)
    await admin
      .from('notifications')
      .insert(
        recipients.map((userId) => ({
          user_id: userId,
          order_id: order.id,
          type: 'order_completed',
          title: 'Заказ завершён',
          body: 'Клиент подтвердил завершение уборки',
        })),
      );
  revalidatePath('/profile');
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/company/orders');
}

export async function cancelOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');

  const admin = createAdminClient(
    process.env.LOCAL_API_URL || 'http://127.0.0.1:54321',
    process.env.LOCAL_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: order } = await admin
    .from('orders')
    .select('id,status,selected_company_id')
    .eq('id', orderId)
    .eq('client_id', user.id)
    .in('status', ['created', 'searching', 'offered'])
    .maybeSingle();
  if (!order) throw new Error('Этот заказ уже нельзя отменить');

  const { error } = await backend.rpc('transition_order_status', {
    target_order_id: order.id, next_status: 'cancelled', note: 'Клиент отменил заказ',
  });
  if (error) throw new Error(error.message);

  if (order.selected_company_id) {
    const { data: company } = await admin
      .from('company_profiles')
      .select('owner_id')
      .eq('id', order.selected_company_id)
      .maybeSingle();
    if (company?.owner_id)
      await admin
        .from('notifications')
        .insert({
          user_id: company.owner_id,
          order_id: order.id,
          type: 'order_cancelled',
          title: 'Заказ отменён',
          body: 'Клиент отменил заказ до начала выполнения',
        });
  }

  revalidatePath('/profile');
  revalidatePath('/company/orders');
}

export async function joinCleanerCommunity(
  _previous: string,
  formData: FormData,
): Promise<string> {
  const code = String(formData.get('community_code') ?? '')
    .trim()
    .toUpperCase();
  if (code.length < 4 || code.length > 32) return 'Проверьте код сообщества.';
  const backend = await createClient();
  const { error } = await backend.rpc('join_cleaner_community', {
    community_code: code,
  });
  if (error)
    return 'Не удалось вступить. Проверьте код и активность сообщества у администратора.';
  revalidatePath('/profile');
  revalidatePath('/company/employees');
  return 'Вы вступили в сообщество.';
}
