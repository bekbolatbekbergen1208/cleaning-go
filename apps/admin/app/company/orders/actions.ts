'use server';

import { revalidatePath } from 'next/cache';
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

  const { error: priceError } = await supabase.rpc('set_company_order_price', {
    target_order_id: orderId,
    target_total_minor: totalMinor,
  });
  if (priceError) throw new Error(priceError.message);
  const { error: acceptError } = await supabase.rpc('accept_order', {
    target_order_id: orderId,
    target_company_id: company.id,
  });
  if (acceptError) throw new Error(acceptError.message);

  revalidatePath('/company');
  revalidatePath('/company/orders');
  revalidatePath('/cleaner/company-orders');
}
