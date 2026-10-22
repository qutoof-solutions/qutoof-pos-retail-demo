export const LOYALTY_EGP_PER_POINT = 10;
export const LOYALTY_DISCOUNT_MINOR_PER_POINT = 10;

export function pointsEarnedForPurchase(totalMinor: number): number {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new RangeError("totalMinor must be a non-negative integer");
  return Math.floor(totalMinor / (LOYALTY_EGP_PER_POINT * 100));
}

export function discountMinorForPoints(points: number): number {
  if (!Number.isInteger(points) || points < 0) throw new RangeError("points must be a non-negative integer");
  return points * LOYALTY_DISCOUNT_MINOR_PER_POINT;
}
