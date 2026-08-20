'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

export async function publishCompanyOrder(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '');
  const totalMinor = Math.round(Number(formData.get('total_kzt')) * 100);
  if (!orderId || !Number.isFinite(totalMinor) || totalMinor < 10000) throw new Error('Укажите цену от 100 ₸');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Сначала войдите в аккаунт');
  const { data: company } = await supabase.from('company_profiles').select('id').eq('owner_id', user.id).single();
  if (!company) throw new Error('Компания не найдена');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order } = await admin.from('orders').select('id,client_id,status').eq('id', orderId).eq('selected_company_id', company.id).in('status', ['searching', 'offered']).maybeSingle();
  if (!order) throw new Error('Заказ уже недоступен для публикации');
  const { error: priceError } = await admin.from('orders').update({
    subtotal_minor: totalMinor,
    total_minor: totalMinor,
    price_confirmed_at: new Date().toISOString(),
    price_confirmed_by: user.id,
  }).eq('id', orderId).eq('selected_company_id', company.id);
  if (priceError) throw new Error(priceError.message);
  await admin.from('order_items').update({ unit_price_minor: totalMinor, total_minor: totalMinor }).eq('order_id', orderId).is('service_option_id', null);
  await admin.from('notifications').insert({
    user_id: order.client_id,
    order_id: order.id,
    type: 'company_price',
    title: 'Компания указала цену',
    body: `Цена заказа: ${(totalMinor / 100).toLocaleString('ru-RU')} ₸`,
    data: { total_minor: totalMinor },
  });
  const { error: acceptError } = await supabase.rpc('accept_order', {
    target_order_id: orderId,
    target_company_id: company.id,
  });
  if (acceptError) throw new Error(acceptError.message);

  revalidatePath('/company');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}
