'use server';

import { revalidatePath } from 'next/cache';
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
}
