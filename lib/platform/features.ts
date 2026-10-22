import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { platformFeatureFlags, platformPlans } from "@/lib/db/schema";
import { withCatalogFeatureDefaults } from "@/lib/platform/catalog";
import { activityCodeFromPlanCode, resolvePlanFeatureContract } from "@/lib/platform/activity-contract";

type PlatformDatabase = ReturnType<typeof getDb>;

export async function isFeatureEnabled(db: PlatformDatabase, key: string, fallback = true): Promise<boolean> {
  const [flag] = await db.select({ enabled: platformFeatureFlags.enabled }).from(platformFeatureFlags).where(eq(platformFeatureFlags.key, key)).limit(1);
  return flag?.enabled ?? fallback;
}

export function planFeatureGranted(featuresJson: string, key: string): boolean {
  return resolvePlanFeatureContract({ featuresJson }).features[key] === true;
}

export async function isPlanFeatureEnabled(db: PlatformDatabase, platformPlanId: string | null, key: string): Promise<boolean> {
  if (!platformPlanId) return true;
  const [plan] = await db.select({ nameEn: platformPlans.nameEn, code: platformPlans.code, featuresJson: platformPlans.featuresJson }).from(platformPlans).where(eq(platformPlans.id, platformPlanId)).limit(1);
  if (!plan) return false;
  const contract = resolvePlanFeatureContract({ featuresJson: plan.featuresJson, activityCode: activityCodeFromPlanCode(plan.code), fallbackFeatures: {} });
  return withCatalogFeatureDefaults(plan.nameEn, contract.features, plan.code)[key] === true;
}
