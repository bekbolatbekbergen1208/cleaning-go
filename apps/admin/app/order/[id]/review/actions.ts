'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/server';

export async function publishReview(orderId: string, rating: number, text: string) {
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Укажите оценку от 1 до 5.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Сначала войдите в аккаунт.' };

  const { error: reviewError } = await supabase.rpc('create_review', {
    target_order_id: orderId,
    target_rating: rating,
    target_text: text.trim() || null,
    target_tags: [],
  });
  const alreadyPublished = reviewError?.code === '23505' || reviewError?.message.includes('reviews_order_id_key');
  if (reviewError && !alreadyPublished) return { error: 'Не удалось опубликовать отзыв. Попробуйте ещё раз.' };

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: workers } = await admin.from('order_workers').select('cleaner_id').eq('order_id', orderId);

  await Promise.all([...new Set((workers ?? []).map(worker => worker.cleaner_id))].map(async cleanerId => {
    const { data: assignments } = await admin.from('order_workers').select('order_id').eq('cleaner_id', cleanerId);
    const orderIds = [...new Set((assignments ?? []).map(item => item.order_id))];
    if (!orderIds.length) return;
    const { data: reviews } = await admin.from('reviews').select('id,rating').in('order_id', orderIds).eq('is_visible', true);
    if (!reviews?.length) return;
    const average = reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length;
    await admin.from('cleaner_profiles').update({ rating: Number(average.toFixed(2)), reviews_count: reviews.length }).eq('user_id', cleanerId);
  }));

  return { error: null };
}
