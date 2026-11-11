'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/backend/server';

export async function claimCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  if (!orderId) throw new Error('Заказ не указан');
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');

  const { data: order, error } = await backend.rpc('claim_company_order', { target_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/company/orders');
  if (['астана', 'astana', 'нур-султан'].includes(order?.city?.trim().toLowerCase())) redirect(`/order/${orderId}/tracking`);
}

export async function advanceCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const expectedStatus = String(formData.get('expected_status') ?? '');
  if (!['accepted', 'on_the_way', 'arrived', 'in_progress'].includes(expectedStatus)) throw new Error('Обновите страницу заказа.');
  let completionPaths: unknown;
  try { completionPaths = JSON.parse(String(formData.get('completion_photo_paths') ?? '[]')); }
  catch { throw new Error('Некорректный фотоотчёт'); }
  if (!Array.isArray(completionPaths) || completionPaths.length > 10 || completionPaths.some(path => typeof path !== 'string')) throw new Error('Некорректный фотоотчёт');
  const backend = await createClient();
  const { error } = await backend.rpc('advance_company_order', { target_order_id: orderId, completion_paths: completionPaths, expected_status: expectedStatus });
  if (error) throw new Error(error.message);
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/profile');
  revalidatePath('/company/orders');
}

export async function advanceCompanyOrderWithState(_previous: string, formData: FormData): Promise<string> {
  try { await advanceCompanyOrder(formData); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'Не удалось изменить этап. Повторите попытку.'; }
}
