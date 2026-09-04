'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

export async function claimCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  if (!orderId) throw new Error('Заказ не указан');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');

  const { error } = await supabase.rpc('claim_company_order', { target_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/company/orders');
}

const nextStatuses: Record<string, string> = {
  accepted: 'on_the_way',
  on_the_way: 'arrived',
  arrived: 'in_progress',
  in_progress: 'completed_by_cleaner',
};

export async function advanceCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: worker } = await admin.from('order_workers').select('order_id').eq('order_id', orderId).eq('cleaner_id', user.id).maybeSingle();
  if (!worker) throw new Error('Сначала возьмите этот заказ');
  const { data: order } = await admin.from('orders').select('id,status,client_id,selected_company_id,photo_urls').eq('id', orderId).maybeSingle();
  const nextStatus = order ? nextStatuses[order.status] : null;
  if (!order || !nextStatus) throw new Error('Этап заказа уже изменён');
  let completionPaths: string[] = [];
  if (nextStatus === 'completed_by_cleaner') {
    try { completionPaths = JSON.parse(String(formData.get('completion_photo_paths') ?? '[]')); } catch { completionPaths = []; }
    completionPaths = completionPaths.filter(path => typeof path === 'string' && path.startsWith(`${user.id}/completion-${order.id}-`));
    if (!completionPaths.length) throw new Error('Для завершения нужен фотоотчёт');
  }
  const update = nextStatus === 'completed_by_cleaner' ? { status: nextStatus, photo_urls: [...(order.photo_urls ?? []), ...completionPaths] } : { status: nextStatus };
  const { error } = await admin.from('orders').update(update).eq('id', order.id).eq('status', order.status);
  if (error) throw new Error(error.message);
  await admin.from('order_status_history').insert({ order_id: order.id, from_status: order.status, to_status: nextStatus, changed_by: user.id });
  const labels: Record<string, string> = { on_the_way: 'Клинер выехал', arrived: 'Клинер прибыл', in_progress: 'Уборка началась', completed_by_cleaner: 'Клинер завершил уборку' };
  const notifications = [{ user_id: order.client_id, order_id: order.id, type: 'order_status', title: labels[nextStatus], body: nextStatus === 'completed_by_cleaner' ? 'Подтвердите завершение в своём профиле' : 'Статус вашего заказа обновлён' }];
  const { data: company } = await admin.from('company_profiles').select('owner_id').eq('id', order.selected_company_id).maybeSingle();
  if (company) notifications.push({ user_id: company.owner_id, order_id: order.id, type: 'order_status', title: labels[nextStatus], body: 'Статус заказа обновлён клинером' });
  await admin.from('notifications').insert(notifications);
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/profile');
  revalidatePath('/company/orders');
}
