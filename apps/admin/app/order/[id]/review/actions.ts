'use server';

import { createClient } from '../../../../lib/backend/server';

export async function publishReview(
  orderId: string,
  rating: number,
  text: string,
) {
  if (
    typeof orderId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(orderId) ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  )
    return { error: 'Укажите заказ и оценку от 1 до 5.' };
  if (typeof text !== 'string' || text.trim().length > 2000)
    return { error: 'Комментарий должен содержать не более 2000 символов.' };
  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user) return { error: 'Сначала войдите в аккаунт.' };
  // SQL computes ratings for direct and company assignments in the same
  // transaction. A second calculation here could overwrite a newer moderation.
  const { error } = await backend.rpc('create_review', {
    target_order_id: orderId,
    target_rating: rating,
    target_text: text.trim() || null,
    target_tags: [],
  });
  return {
    error: error ? 'Не удалось опубликовать отзыв. Попробуйте ещё раз.' : null,
  };
}
