import { addBillingCycle, type BillingCycle } from "@/lib/platform/billing";
import type { ResourceAddonType } from "@/lib/platform/catalog";

export type ResourceAddonGrant = {
  resourceType: ResourceAddonType;
  quantity: number;
  baselineCount: number;
  baselineUserCount: number;
  startsAt: Date;
  endsAt: Date;
};

export type ResourceLimitSummary = {
  grandfatheredBaseline: number | null;
  activeAddonQuantity: number;
};

export function calculateAddonAmountMinor(input: {
  unitPriceMinor: number;
  quantity: number;
  billingCycle: BillingCycle;
  customDays?: number | null;
  subscriptionEndsAt: Date;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const remainingMs = input.subscriptionEndsAt.getTime() - now.getTime();
  if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor < 1) throw new RangeError("سعر الإضافة غير صالح");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 25) throw new RangeError("عدد الإضافات يجب أن يكون بين 1 و25");
  if (remainingMs <= 0) throw new RangeError("انتهت فترة الاشتراك الحالية");
  const cycleEnd = addBillingCycle(now, input.billingCycle, input.customDays ?? null);
  const cycleMs = cycleEnd.getTime() - now.getTime();
  if (cycleMs <= 0) throw new RangeError("دورة الإضافة غير صالحة");
  const amount = Math.ceil((input.unitPriceMinor * input.quantity * remainingMs) / cycleMs);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("قيمة طلب الإضافة خارج النطاق المسموح");
  return amount;
}

function relevantTypes(resourceType: ResourceAddonType): ResourceAddonType[] {
  return resourceType === "user" ? ["user", "doctor"] : [resourceType];
}

function baselineFor(grant: ResourceAddonGrant, resourceType: ResourceAddonType): number {
  return resourceType === "user" ? grant.baselineUserCount : grant.baselineCount;
}

export function summarizeAddonResourceLimit(
  grants: ResourceAddonGrant[],
  resourceType: ResourceAddonType,
  now = new Date(),
): ResourceLimitSummary {
  const relevant = grants.filter((grant) => relevantTypes(resourceType).includes(grant.resourceType));
  if (!relevant.length) return { grandfatheredBaseline: null, activeAddonQuantity: 0 };
  const active = relevant.filter((grant) => grant.startsAt.getTime() <= now.getTime() && grant.endsAt.getTime() > now.getTime());
  const basis = active.length
    ? active.reduce((selected, grant) => grant.startsAt.getTime() < selected.startsAt.getTime() ? grant : selected)
    : relevant.reduce((selected, grant) => grant.startsAt.getTime() > selected.startsAt.getTime() ? grant : selected);
  return {
    grandfatheredBaseline: baselineFor(basis, resourceType),
    activeAddonQuantity: active.reduce((total, grant) => total + grant.quantity, 0),
  };
}

function addonOnlyLimit(grants: ResourceAddonGrant[], resourceType: ResourceAddonType, now: Date): number | null {
  const summary = summarizeAddonResourceLimit(grants, resourceType, now);
  if (summary.grandfatheredBaseline === null) return null;
  return summary.grandfatheredBaseline + summary.activeAddonQuantity;
}

/** Historical add-on-only cap retained for doctor-seat enforcement and unassigned legacy plans. */
export function getAddonResourceLimit(grants: ResourceAddonGrant[], resourceType: ResourceAddonType, now = new Date()): number | null {
  return addonOnlyLimit(grants, resourceType, now);
}

/**
 * Computes a plan resource cap as the base plan limit plus currently active add-on units.
 * A purchase baseline is a grandfathering floor for legacy tenants whose existing usage
 * already exceeded the plan cap when the add-on was approved; it is never added twice.
 * A null plan limit means unlimited, while expired add-ons no longer add capacity.
 */
export function getCombinedResourceLimit(
  basePlanLimit: number | null,
  grants: ResourceAddonGrant[],
  resourceType: ResourceAddonType,
  now = new Date(),
): number | null {
  if (resourceType === "doctor") return addonOnlyLimit(grants, resourceType, now);
  if (basePlanLimit === null) return null;
  const summary = summarizeAddonResourceLimit(grants, resourceType, now);
  return Math.max(basePlanLimit, summary.grandfatheredBaseline ?? basePlanLimit) + summary.activeAddonQuantity;
}

export function getAddonUsage(grants: ResourceAddonGrant[], resourceType: ResourceAddonType, used: number, now = new Date()): { limit: number | null; used: number; available: number | null } {
  const limit = getAddonResourceLimit(grants, resourceType, now);
  return { limit, used, available: limit === null ? null : Math.max(0, limit - used) };
}

export function getCombinedResourceUsage(
  basePlanLimit: number | null,
  grants: ResourceAddonGrant[],
  resourceType: ResourceAddonType,
  used: number,
  now = new Date(),
): { baseLimit: number | null; addonQuantity: number; limit: number | null; used: number; available: number | null } {
  const summary = summarizeAddonResourceLimit(grants, resourceType, now);
  const limit = getCombinedResourceLimit(basePlanLimit, grants, resourceType, now);
  return {
    baseLimit: basePlanLimit,
    addonQuantity: summary.activeAddonQuantity,
    limit,
    used,
    available: limit === null ? null : Math.max(0, limit - used),
  };
}

export function isProviderSeat(role: string): boolean {
  return role === "provider" || role === "doctor" || role === "specialist";
}

export function resourceAddonLabel(resourceType: ResourceAddonType): string {
  const labels: Record<ResourceAddonType, string> = {
    warehouse: "مخزن إضافي",
    branch: "فرع إضافي",
    user: "مستخدم إضافي",
    doctor: "طبيب إضافي",
  };
  return labels[resourceType];
}
