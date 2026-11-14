'use server';

import { createClient } from '../../../../lib/backend/server';

const validRating = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;

export async function publishReview(
  orderId: string,
  companyRating: number | null,
  cleanerRatings: Record<string, number>,
  text: string,
) {
  if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId))
    return { error: 'Заказ не найден.' };
  if (companyRating !== null && !validRating(companyRating))
    return { error: 'Оценка компании должна быть от 1 до 5.' };
  if (
    !cleanerRatings ||
    typeof cleanerRatings !== 'object' ||
    Object.keys(cleanerRatings).length > 50 ||
    Object.entries(cleanerRatings).some(([id, value]) => !/^[0-9a-f-]{36}$/i.test(id) || !validRating(value))
  )
    return { error: 'Оценка клинера должна быть от 1 до 5.' };
  if (typeof text !== 'string' || text.trim().length > 2000)
    return { error: 'Комментарий должен содержать не более 2000 символов.' };
  const backend = await createClient();
  const {
    data: { user },
  } = await backend.auth.getUser();
  if (!user) return { error: 'Сначала войдите в аккаунт.' };
  // SQL validates that every rated cleaner worked on this order and updates the
  // company's and each cleaner's rating in one transaction.
  const { error } = await backend.rpc('create_order_review', {
    target_order_id: orderId,
    target_company_rating: companyRating,
    target_cleaner_ratings: cleanerRatings,
    target_text: text.trim() || null,
  });
  return {
    error: error ? 'Не удалось опубликовать отзыв. Попробуйте ещё раз.' : null,
  };
}
