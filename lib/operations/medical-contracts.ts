export const INSURANCE_CLAIM_STATUSES = ["open", "submitted", "approved", "rejected", "paid"] as const;
export type InsuranceClaimStatus = (typeof INSURANCE_CLAIM_STATUSES)[number];

const allowedTransitions: Record<InsuranceClaimStatus, readonly InsuranceClaimStatus[]> = {
  open: ["submitted", "rejected"],
  submitted: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  rejected: [],
  paid: [],
};

export function canTransitionInsuranceClaim(from: InsuranceClaimStatus, to: InsuranceClaimStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertInsuranceClaimTransition(from: InsuranceClaimStatus, to: InsuranceClaimStatus): void {
  if (!canTransitionInsuranceClaim(from, to)) throw new Error(`INSURANCE_CLAIM_TRANSITION_NOT_ALLOWED:${from}:${to}`);
}

export function assertExpectedVersion(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1 || actual !== expected) throw new Error("VERSION_CONFLICT");
}

export function isMembershipValid(input: { status: "active" | "cancelled"; startsAt: Date; endsAt: Date }, at = new Date()): boolean {
  return input.status === "active" && input.startsAt.getTime() <= at.getTime() && input.endsAt.getTime() > at.getTime();
}

export function canConsumePt(input: { membershipValid: boolean; usedSessions: number; totalSessions: number }): boolean {
  return input.membershipValid && input.totalSessions > 0 && input.usedSessions >= 0 && input.usedSessions < input.totalSessions;
}
