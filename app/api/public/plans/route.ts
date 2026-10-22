import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { classifyCatalogFeaturesJson, RESOURCE_ADDON_MARKERS } from "@/lib/platform/catalog";
import { catalogCode, catalogBaseCode } from "@/lib/platform/catalog-identity";
import { activityCodeFromPlanCode } from "@/lib/platform/activity-contract";
import { platformPlans, platformSettings } from "@/lib/db/schema";
import { discountedPlanPriceMinor, planDiscountLabel, readPlanDiscountSettings } from "@/lib/platform/discounts";
import { ensurePlatformPlanDescriptionColumns } from "@/lib/platform/plan-schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const publicCacheHeaders = { "Cache-Control": "no-store, max-age=0" };

function readPublicFeatures(serialized: string | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(serialized ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] =>
        typeof entry[1] === "boolean"
        && !Object.values(RESOURCE_ADDON_MARKERS).includes(entry[0] as (typeof RESOURCE_ADDON_MARKERS)[keyof typeof RESOURCE_ADDON_MARKERS]),
      ),
    );
  } catch {
    return {};
  }
}

export async function GET(): Promise<Response> {
  try {
    await ensurePlatformPlanDescriptionColumns();
    const db = getDb();
    const [rows, settingRows] = await Promise.all([db
      .select({
        id: platformPlans.id,
        code: platformPlans.code,
        nameAr: platformPlans.nameAr,
        nameEn: platformPlans.nameEn,
        descriptionAr: platformPlans.descriptionAr,
        descriptionEn: platformPlans.descriptionEn,
        billingCycle: platformPlans.billingCycle,
        customDays: platformPlans.customDays,
        priceMinor: platformPlans.priceMinor,
        currency: platformPlans.currency,
        featuresJson: platformPlans.featuresJson,
        maxUsers: platformPlans.maxUsers,
        maxBranches: platformPlans.maxBranches,
        maxWarehouses: platformPlans.maxWarehouses,
      })
      .from(platformPlans)
      .where(eq(platformPlans.isActive, true))
      .orderBy(asc(platformPlans.priceMinor)), db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings)]);
    const discountSettings = readPlanDiscountSettings(Object.fromEntries(settingRows.map(({ key, value }) => [key, value])));
    const monthlyByBase = new Map(rows.filter((row) => row.billingCycle === "monthly").map((row) => [catalogBaseCode(row), row.priceMinor]));

    const plans: Array<Record<string, unknown>> = [];
    const addOns: Array<Record<string, unknown>> = [];
    for (const { featuresJson, ...plan } of rows) {
      const classification = classifyCatalogFeaturesJson(featuresJson);
      if (classification.kind === "invalid_addon") continue;
      const baseName = catalogBaseCode(plan);
      const displayPriceMinor = discountedPlanPriceMinor({ priceMinor: plan.priceMinor, billingCycle: plan.billingCycle, monthlyPriceMinor: monthlyByBase.get(baseName), settings: discountSettings });
      if (classification.kind === "addon") {
        addOns.push({ ...plan, resourceType: classification.resourceType });
        continue;
      }
      plans.push({ ...plan, activityCode: activityCodeFromPlanCode(catalogCode(plan)), priceMinor: displayPriceMinor, originalPriceMinor: plan.priceMinor, discountLabelAr: planDiscountLabel(discountSettings, "ar", plan.billingCycle), discountLabelEn: planDiscountLabel(discountSettings, "en", plan.billingCycle), ...discountSettings, features: readPublicFeatures(featuresJson), limits: { users: plan.maxUsers, branches: plan.maxBranches, warehouses: plan.maxWarehouses } });
    }

    return Response.json({ plans, addOns }, { headers: publicCacheHeaders });
  } catch {
    return Response.json(
      { plans: [], addOns: [], error: "تعذر تحميل الباقات حاليًا" },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
