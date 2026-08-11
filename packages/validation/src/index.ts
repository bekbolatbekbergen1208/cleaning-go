import { z } from 'zod';

export const publicRegistrationRoles = ['client', 'cleaner', 'company_owner'] as const;

export const registrationSchema = z
  .object({
    email: z.string().email('Введите корректный email').optional(),
    phone: z.string().min(10, 'Введите корректный телефон').optional(),
    password: z.string().min(8, 'Минимум 8 символов'),
    fullName: z.string().trim().min(2, 'Укажите имя'),
    role: z.enum(publicRegistrationRoles),
    referralCode: z.string().trim().toUpperCase().optional(),
    acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'Примите соглашение' }) }),
    acceptedPrivacy: z.literal(true, { errorMap: () => ({ message: 'Примите политику' }) }),
  })
  .refine((value) => value.email || value.phone, {
    message: 'Укажите email или телефон',
    path: ['email'],
  });

export const orderDraftSchema = z.object({
  serviceId: z.string().uuid(),
  addressId: z.string().uuid(),
  scheduledAt: z.string().datetime().refine((v) => new Date(v) > new Date(), 'Выберите будущее время'),
  areaSqM: z.coerce.number().int().min(1).max(10_000),
  roomsCount: z.coerce.number().int().min(1).max(100),
  comment: z.string().max(1000).optional(),
  executorPreference: z.enum(['cleaner', 'company', 'any']),
  selectedCleanerId: z.string().uuid().optional(),
  selectedCompanyId: z.string().uuid().optional(),
  paymentMethod: z.enum(['cash', 'card', 'test']),
  optionIds: z.array(z.string().uuid()),
});

export const reviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
});

export function calculateMoney(
  totalMinor: number,
  platformFeeBps: number,
  referralBps: number,
  hasEligibleReferral: boolean,
) {
  if (![totalMinor, platformFeeBps, referralBps].every(Number.isSafeInteger)) {
    throw new Error('Money inputs must be safe integers');
  }
  if (totalMinor < 0 || platformFeeBps < 0 || referralBps < 0) {
    throw new Error('Money inputs cannot be negative');
  }
  const platformFeeMinor = Math.round((totalMinor * platformFeeBps) / 10_000);
  const referralRewardMinor = hasEligibleReferral
    ? Math.round((totalMinor * referralBps) / 10_000)
    : 0;
  const executorAmountMinor = totalMinor - platformFeeMinor - referralRewardMinor;
  if (executorAmountMinor < 0) throw new Error('Configured fees exceed order total');
  return { totalMinor, platformFeeMinor, referralRewardMinor, executorAmountMinor };
}

export const orderStatusTransitions = {
  created: ['searching', 'cancelled'],
  searching: ['offered', 'accepted', 'cancelled'],
  offered: ['accepted', 'searching', 'cancelled'],
  accepted: ['on_the_way', 'cancelled', 'disputed'],
  on_the_way: ['arrived', 'cancelled', 'disputed'],
  arrived: ['in_progress', 'cancelled', 'disputed'],
  in_progress: ['completed_by_cleaner', 'disputed'],
  completed_by_cleaner: ['completed', 'disputed'],
  completed: ['disputed'],
  cancelled: [],
  disputed: [],
} as const;

export type OrderLifecycleStatus = keyof typeof orderStatusTransitions;

export function canTransitionOrder(from: OrderLifecycleStatus, to: OrderLifecycleStatus) {
  return (orderStatusTransitions[from] as readonly string[]).includes(to);
}

export function assertReferralIsAllowed(referrerId: string, referredUserId: string, alreadyLinked: boolean) {
  if (referrerId === referredUserId) throw new Error('Self-referral is not allowed');
  if (alreadyLinked) throw new Error('Referral can only be linked once');
  return true;
}

export function canCreateReview(orderStatus: OrderLifecycleStatus, isOrderClient: boolean, alreadyReviewed: boolean) {
  return orderStatus === 'completed' && isOrderClient && !alreadyReviewed;
}

export function shouldFinalizeOrder(status: OrderLifecycleStatus, paymentConfirmed: boolean, alreadyFinalized: boolean) {
  return status === 'completed' && paymentConfirmed && !alreadyFinalized;
}

export function calculateCompanyPromoBonus(totalMinor: number, cashbackBps: number) {
  if (!Number.isSafeInteger(totalMinor) || !Number.isSafeInteger(cashbackBps) || totalMinor < 0 || cashbackBps < 0 || cashbackBps > 2000) {
    throw new Error('Invalid company promo bonus inputs');
  }
  return Math.round((totalMinor * cashbackBps) / 10_000);
}

export function applyRestrictedCompanyBonus(totalMinor: number, balanceMinor: number, selectedCompanyId: string, bonusCompanyId: string) {
  if (![totalMinor, balanceMinor].every(Number.isSafeInteger) || totalMinor < 0 || balanceMinor < 0) throw new Error('Invalid restricted bonus inputs');
  const usedMinor = selectedCompanyId === bonusCompanyId ? Math.min(totalMinor, balanceMinor) : 0;
  return { usedMinor, payableMinor: totalMinor - usedMinor, balanceAfterMinor: balanceMinor - usedMinor };
}
