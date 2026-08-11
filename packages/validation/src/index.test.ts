import { describe, expect, it } from 'vitest';
import { applyRestrictedCompanyBonus, assertReferralIsAllowed, calculateCompanyPromoBonus, calculateMoney, canCreateReview, canTransitionOrder, shouldFinalizeOrder } from './index';

describe('calculateMoney', () => {
  it('calculates the documented 20 000 KZT example in tiyn', () => {
    expect(calculateMoney(2_000_000, 1_500, 500, true)).toEqual({
      totalMinor: 2_000_000,
      platformFeeMinor: 300_000,
      referralRewardMinor: 100_000,
      executorAmountMinor: 1_600_000,
    });
  });

  it('does not award an ineligible referral', () => {
    expect(calculateMoney(100_000, 1_500, 500, false).referralRewardMinor).toBe(0);
  });
});

describe('order lifecycle', () => {
  it('allows only documented forward transitions', () => {
    expect(canTransitionOrder('accepted', 'on_the_way')).toBe(true);
    expect(canTransitionOrder('on_the_way', 'arrived')).toBe(true);
    expect(canTransitionOrder('arrived', 'completed')).toBe(false);
    expect(canTransitionOrder('completed', 'in_progress')).toBe(false);
  });

  it('finalizes only a paid completed order and only once', () => {
    expect(shouldFinalizeOrder('completed', true, false)).toBe(true);
    expect(shouldFinalizeOrder('completed', true, true)).toBe(false);
    expect(shouldFinalizeOrder('completed', false, false)).toBe(false);
  });
});

describe('referrals and reviews', () => {
  it('rejects self-referral and a second referral link', () => {
    expect(() => assertReferralIsAllowed('same', 'same', false)).toThrow('Self-referral');
    expect(() => assertReferralIsAllowed('a', 'b', true)).toThrow('only be linked once');
    expect(assertReferralIsAllowed('a', 'b', false)).toBe(true);
  });

  it('allows one review only from the client of a completed order', () => {
    expect(canCreateReview('completed', true, false)).toBe(true);
    expect(canCreateReview('in_progress', true, false)).toBe(false);
    expect(canCreateReview('completed', false, false)).toBe(false);
    expect(canCreateReview('completed', true, true)).toBe(false);
  });
});

describe('company promo bonus', () => {
  it('calculates the default 5% bonus in minor units', () => {
    expect(calculateCompanyPromoBonus(1_000_000, 500)).toBe(50_000);
  });

  it('rejects a company bonus above the allowed 20%', () => {
    expect(() => calculateCompanyPromoBonus(100_000, 2001)).toThrow('Invalid company promo bonus');
  });

  it('uses 2 000 KZT only at the company that issued it', () => {
    expect(applyRestrictedCompanyBonus(1_000_000, 200_000, 'company-a', 'company-a')).toEqual({ usedMinor: 200_000, payableMinor: 800_000, balanceAfterMinor: 0 });
    expect(applyRestrictedCompanyBonus(1_000_000, 200_000, 'company-b', 'company-a')).toEqual({ usedMinor: 0, payableMinor: 1_000_000, balanceAfterMinor: 200_000 });
  });
});
