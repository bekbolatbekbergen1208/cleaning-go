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

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: membership } = await admin.from('company_cleaners').select('company_id').eq('cleaner_id', user.id).eq('is_active', true).maybeSingle();
  if (!membership) throw new Error('Сначала компания должна принять вас в сотрудники');
  const { data: order } = await admin.from('orders').select('id,client_id,required_workers,scheduled_at').eq('id', orderId).eq('selected_company_id', membership.company_id).eq('status', 'accepted').maybeSingle();
  if (!order) throw new Error('Заказ уже недоступен');
  const { count } = await admin.from('order_workers').select('id', { count: 'exact', head: true }).eq('order_id', order.id);
  if ((count ?? 0) >= Number(order.required_workers)) throw new Error('Команда для этого заказа уже набрана');
  const { error } = await admin.from('order_workers').insert({ order_id: order.id, cleaner_id: user.id });
  if (error && error.code !== '23505') throw new Error(error.message);
  if (!error) {
    await admin.from('notifications').insert([
      { user_id: order.client_id, order_id: order.id, type: 'employee_assigned', title: 'Клинер принял заказ', body: 'Клинер компании присоединился к вашему заказу' },
      { user_id: user.id, order_id: order.id, type: 'cleaning_reminder', title: 'Вы приняли заказ', body: `Уборка начнётся ${new Date(order.scheduled_at).toLocaleString('ru-RU')}` },
    ]);
  }
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
  const { data: order } = await admin.from('orders').select('id,status,client_id,selected_company_id').eq('id', orderId).maybeSingle();
  const nextStatus = order ? nextStatuses[order.status] : null;
  if (!order || !nextStatus) throw new Error('Этап заказа уже изменён');
  const { error } = await admin.from('orders').update({ status: nextStatus }).eq('id', order.id).eq('status', order.status);
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
