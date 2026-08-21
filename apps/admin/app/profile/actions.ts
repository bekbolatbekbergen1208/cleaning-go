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
  const { data: order } = await admin.from('orders').select('id,selected_company_id,total_minor,required_workers,executor_amount_minor').eq('id', orderId).eq('client_id', user.id).eq('status', 'offered').is('price_confirmed_at', null).maybeSingle();
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
  const { data: company } = await admin.from('company_profiles').select('owner_id').eq('id', order.selected_company_id).single();
  if (company) await admin.from('notifications').insert({ user_id: company.owner_id, order_id: order.id, type: 'price_accepted', title: 'Клиент подтвердил цену', body: `Клиент согласился на ${(Number(order.total_minor)/100).toLocaleString('ru-RU')} ₸` });
  revalidatePath('/profile');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}
