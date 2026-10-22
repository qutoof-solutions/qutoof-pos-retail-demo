import { eq } from "drizzle-orm";
import { platformPlans, tenantResourceAddons, tenants } from "@/lib/db/schema";
import type { getDb } from "@/lib/db/client";
import { getAddonResourceLimit, getCombinedResourceLimit, type ResourceAddonGrant } from "@/lib/platform/addon-entitlements";
import type { ResourceAddonType } from "@/lib/platform/catalog";

type Database = ReturnType<typeof getDb>;

export async function getTenantAddonGrants(db: Database, tenantId: string): Promise<ResourceAddonGrant[]> {
  return db.select({
    resourceType: tenantResourceAddons.resourceType,
    quantity: tenantResourceAddons.quantity,
    baselineCount: tenantResourceAddons.baselineCount,
    baselineUserCount: tenantResourceAddons.baselineUserCount,
    startsAt: tenantResourceAddons.startsAt,
    endsAt: tenantResourceAddons.endsAt,
  }).from(tenantResourceAddons).where(eq(tenantResourceAddons.tenantId, tenantId));
}

export async function getTenantResourceLimit(
  db: Database,
  tenantId: string,
  resourceType: ResourceAddonType,
  now = new Date(),
): Promise<number | null> {
  const [tenant] = await db.select({ planId: tenants.platformPlanId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const grants = await getTenantAddonGrants(db, tenantId);
  if (resourceType === "doctor") return getAddonResourceLimit(grants, resourceType, now);

  if (!tenant?.planId) return getAddonResourceLimit(grants, resourceType, now);
  const [plan] = await db.select({
    maxUsers: platformPlans.maxUsers,
    maxBranches: platformPlans.maxBranches,
    maxWarehouses: platformPlans.maxWarehouses,
  }).from(platformPlans).where(eq(platformPlans.id, tenant.planId)).limit(1);
  if (!plan) return getAddonResourceLimit(grants, resourceType, now);

  const baseLimit = resourceType === "branch"
    ? plan.maxBranches
    : resourceType === "warehouse"
      ? plan.maxWarehouses
      : plan.maxUsers;
  return getCombinedResourceLimit(baseLimit, grants, resourceType, now);
}
