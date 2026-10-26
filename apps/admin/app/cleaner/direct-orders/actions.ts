'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';

const nextStatus: Record<string, string> = { accepted: 'on_the_way', on_the_way: 'arrived', arrived: 'in_progress', in_progress: 'completed_by_cleaner' };

export async function acceptDirectOrder(formData: FormData) {
  const id = String(formData.get('order_id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Заказ не найден');
  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_order', { target_order_id: id, target_company_id: null });
  if (error) throw new Error(error.message);
  revalidatePath('/cleaner/direct-orders');
  revalidatePath('/profile');
}

export async function advanceDirectOrder(formData: FormData) {
  const id = String(formData.get('order_id') ?? '');
  const status = String(formData.get('status') ?? '');
  const next = nextStatus[status];
  if (!/^[0-9a-f-]{36}$/i.test(id) || !next) throw new Error('Этап заказа не найден');
  const supabase = await createClient();
  const { error } = await supabase.rpc('transition_order_status', { target_order_id: id, next_status: next, note: null });
  if (error) throw new Error(error.message);
  revalidatePath('/cleaner/direct-orders');
  revalidatePath('/profile');
}
