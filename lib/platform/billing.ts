export type TenantBillingStatus = "pending_trial" | "active_trial" | "active" | "grace" | "frozen" | "expired" | "cancelled";
export type BillingCycle = "monthly" | "quarterly" | "semi_annual" | "annual" | "custom_days";

export interface TenantBillingDates {
  status: TenantBillingStatus;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
}

export function deriveTenantBillingStatus(tenant: TenantBillingDates, now = new Date(), graceDays = 3): TenantBillingStatus {
  if (tenant.status === "pending_trial" || tenant.status === "frozen" || tenant.status === "cancelled" || tenant.status === "expired") return tenant.status;
  const endsAt = tenant.status === "active_trial" ? tenant.trialEndsAt : tenant.subscriptionEndsAt ?? (tenant.status === "grace" ? tenant.trialEndsAt : null);
  if (!endsAt) return tenant.status === "active_trial" ? "pending_trial" : tenant.status;
  if (now.getTime() < endsAt.getTime()) return tenant.status === "active_trial" ? "active_trial" : "active";
  const graceEnd = endsAt.getTime() + Math.max(0, graceDays) * 86_400_000;
  return now.getTime() < graceEnd ? "grace" : "expired";
}

export function operationalAccessAllowed(status: TenantBillingStatus): boolean {
  return status === "active_trial" || status === "active" || status === "grace";
}

export function addBillingCycle(start: Date, cycle: BillingCycle, customDays?: number | null): Date {
  const result = new Date(start);
  const months: Partial<Record<BillingCycle, number>> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
  if (cycle === "custom_days") {
    if (!Number.isInteger(customDays) || !customDays || customDays < 1 || customDays > 3_650) throw new RangeError("أيام الباقة المخصصة يجب أن تكون بين يوم واحد و10 سنوات");
    result.setUTCDate(result.getUTCDate() + customDays);
    return result;
  }
  const monthCount = months[cycle];
  if (!monthCount) throw new RangeError("دورة الفوترة غير مدعومة");
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + monthCount);
  const lastTargetDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastTargetDay));
  return result;
}

export function safeTrialDays(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 180) return 30;
  return parsed;
}

export function normalizeFeatureKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
}
