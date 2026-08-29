'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../lib/supabase/server';

export async function confirmCompanyPrice(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await admin.from('orders').select('id,selected_company_id,total_minor,required_workers,executor_amount_minor,scheduled_at').eq('id', orderId).eq('client_id', user.id).eq('status', 'offered').is('price_confirmed_at', null).maybeSingle();
  if (!order) throw new Error('Предложение цены уже недоступно');
  if (!order.selected_company_id || Number(order.required_workers) < 1 || Number(order.executor_amount_minor) < 0) throw new Error('Компания не указала состав команды');
  const confirmedAt = new Date().toISOString();
  const { error: assignmentError } = await admin.from('order_assignments').insert({
    order_id: order.id,
    cleaner_id: null,
    company_id: order.selected_company_id,
    assigned_by: user.id,
    accepted_at: confirmedAt,
  });
  if (assignmentError && assignmentError.code !== '23505') throw new Error(assignmentError.message);
  const { error } = await admin.from('orders').update({ price_confirmed_at: confirmedAt, price_confirmed_by: user.id, status: 'accepted' }).eq('id', order.id).eq('client_id', user.id).eq('status', 'offered');
  if (error) throw new Error(error.message);
  await admin.from('order_status_history').insert({ order_id: order.id, from_status: 'offered', to_status: 'accepted', changed_by: user.id, note: 'Клиент подтвердил цену' });
  await admin.from('notifications').insert({ user_id: user.id, order_id: order.id, type: 'cleaning_reminder', title: 'Уборка запланирована', body: `Напоминание: уборка ${new Date(order.scheduled_at).toLocaleString('ru-RU')}` });
  const { data: company } = await admin.from('company_profiles').select('owner_id').eq('id', order.selected_company_id).single();
  if (company) await admin.from('notifications').insert({ user_id: company.owner_id, order_id: order.id, type: 'price_accepted', title: 'Клиент подтвердил цену', body: `Клиент согласился на ${(Number(order.total_minor)/100).toLocaleString('ru-RU')} ₸` });
  revalidatePath('/profile');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}

export async function confirmOrderCompletion(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await admin.from('orders').select('id,selected_company_id').eq('id', orderId).eq('client_id', user.id).eq('status', 'completed_by_cleaner').maybeSingle();
  if (!order) throw new Error('Завершение заказа уже недоступно');
  const { error } = await supabase.rpc('transition_order_status', { target_order_id: order.id, next_status: 'completed', note: 'Клиент подтвердил завершение' });
  if (error) throw new Error(error.message);
  const { data: company } = await admin.from('company_profiles').select('owner_id').eq('id', order.selected_company_id).maybeSingle();
  const { data: workers } = await admin.from('order_workers').select('cleaner_id').eq('order_id', order.id);
  const recipients = [company?.owner_id, ...(workers ?? []).map(worker => worker.cleaner_id)].filter(Boolean) as string[];
  if (recipients.length) await admin.from('notifications').insert(recipients.map(userId => ({ user_id: userId, order_id: order.id, type: 'order_completed', title: 'Заказ завершён', body: 'Клиент подтвердил завершение уборки' })));
  revalidatePath('/profile');
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/company/orders');
}

export async function cancelOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !orderId) throw new Error('Заказ не найден');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await admin
    .from('orders')
    .select('id,status,selected_company_id')
    .eq('id', orderId)
    .eq('client_id', user.id)
    .in('status', ['created', 'searching', 'offered'])
    .maybeSingle();
  if (!order) throw new Error('Этот заказ уже нельзя отменить');

  const cancelledAt = new Date().toISOString();
  const { data: cancelled, error } = await admin
    .from('orders')
    .update({ status: 'cancelled', cancelled_at: cancelledAt })
    .eq('id', order.id)
    .eq('client_id', user.id)
    .eq('status', order.status)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cancelled) throw new Error('Статус заказа уже изменился. Обновите страницу.');

  await admin.from('order_status_history').insert({ order_id: order.id, from_status: order.status, to_status: 'cancelled', changed_by: user.id, note: 'Клиент отменил заказ' });
  if (order.selected_company_id) {
    const { data: company } = await admin.from('company_profiles').select('owner_id').eq('id', order.selected_company_id).maybeSingle();
    if (company?.owner_id) await admin.from('notifications').insert({ user_id: company.owner_id, order_id: order.id, type: 'order_cancelled', title: 'Заказ отменён', body: 'Клиент отменил заказ до начала выполнения' });
  }

  revalidatePath('/profile');
  revalidatePath('/company/orders');
}
