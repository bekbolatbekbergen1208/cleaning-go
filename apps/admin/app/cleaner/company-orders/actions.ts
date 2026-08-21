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
  const { data: order } = await admin.from('orders').select('id,client_id,required_workers').eq('id', orderId).eq('selected_company_id', membership.company_id).eq('status', 'accepted').maybeSingle();
  if (!order) throw new Error('Заказ уже недоступен');
  const { count } = await admin.from('order_workers').select('id', { count: 'exact', head: true }).eq('order_id', order.id);
  if ((count ?? 0) >= Number(order.required_workers)) throw new Error('Команда для этого заказа уже набрана');
  const { error } = await admin.from('order_workers').insert({ order_id: order.id, cleaner_id: user.id });
  if (error && error.code !== '23505') throw new Error(error.message);
  if (!error) {
    await admin.from('notifications').insert({ user_id: order.client_id, order_id: order.id, type: 'employee_assigned', title: 'Клинер принял заказ', body: 'Клинер компании присоединился к вашему заказу' });
  }
  revalidatePath('/cleaner/company-orders');
  revalidatePath('/company/orders');
}
