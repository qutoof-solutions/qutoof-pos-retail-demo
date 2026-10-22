import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { branches, inventoryWarehouses, platformAddonRequests, platformBillingRequests, platformInvoices, platformPlans, platformSettings, tenantResourceAddons, users } from "@/lib/db/schema";
import { classifyCatalogFeaturesJson } from "@/lib/platform/catalog";
import { getAddonUsage, getCombinedResourceUsage, type ResourceAddonGrant } from "@/lib/platform/addon-entitlements";
import { isFeatureEnabled } from "@/lib/platform/features";
import { requireOperationAccess } from "@/lib/server/operations";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowBillingAccess: true });
  if (!access.ok) return access.response;
  const { db, tenant, tenantId } = access.context;
  const keys = ["trial_days", "grace_days", "billing.vodafone_cash_number", "billing.instapay_qr_url", "billing.currency"];
  const [catalogRows, requests, addonRequests, invoices, settings, billingEnabled, resourceGrants, branchCount, warehouseCount, userCount, doctorCount] = await Promise.all([
    db.select({ id: platformPlans.id, code: platformPlans.code, nameAr: platformPlans.nameAr, nameEn: platformPlans.nameEn, billingCycle: platformPlans.billingCycle, customDays: platformPlans.customDays, priceMinor: platformPlans.priceMinor, currency: platformPlans.currency, featuresJson: platformPlans.featuresJson, maxUsers: platformPlans.maxUsers, maxBranches: platformPlans.maxBranches, maxWarehouses: platformPlans.maxWarehouses }).from(platformPlans).where(eq(platformPlans.isActive, true)).orderBy(platformPlans.priceMinor),
    db.select({ id: platformBillingRequests.id, planNameSnapshot: platformBillingRequests.planNameSnapshot, billingCycleSnapshot: platformBillingRequests.billingCycleSnapshot, amountMinor: platformBillingRequests.amountMinor, currency: platformBillingRequests.currency, paymentMethod: platformBillingRequests.paymentMethod, status: platformBillingRequests.status, rejectionReason: platformBillingRequests.rejectionReason, createdAt: platformBillingRequests.createdAt, reviewedAt: platformBillingRequests.reviewedAt }).from(platformBillingRequests).where(eq(platformBillingRequests.tenantId, tenantId)).orderBy(desc(platformBillingRequests.createdAt)).limit(20),
    db.select({ id: platformAddonRequests.id, addonNameSnapshot: platformAddonRequests.addonNameSnapshot, resourceType: platformAddonRequests.resourceType, quantity: platformAddonRequests.quantity, billingCycleSnapshot: platformAddonRequests.billingCycleSnapshot, amountMinor: platformAddonRequests.amountMinor, currency: platformAddonRequests.currency, paymentMethod: platformAddonRequests.paymentMethod, status: platformAddonRequests.status, rejectionReason: platformAddonRequests.rejectionReason, invoiceNumber: platformAddonRequests.invoiceNumber, subscriptionEndSnapshot: platformAddonRequests.subscriptionEndSnapshot, createdAt: platformAddonRequests.createdAt, reviewedAt: platformAddonRequests.reviewedAt }).from(platformAddonRequests).where(eq(platformAddonRequests.tenantId, tenantId)).orderBy(desc(platformAddonRequests.createdAt)).limit(20),
    db.select({ id: platformInvoices.id, invoiceNumber: platformInvoices.invoiceNumber, planNameSnapshot: platformInvoices.planNameSnapshot, amountMinor: platformInvoices.amountMinor, currency: platformInvoices.currency, paymentMethod: platformInvoices.paymentMethod, periodStart: platformInvoices.periodStart, periodEnd: platformInvoices.periodEnd, status: platformInvoices.status, paidAt: platformInvoices.paidAt }).from(platformInvoices).where(eq(platformInvoices.tenantId, tenantId)).orderBy(desc(platformInvoices.paidAt)).limit(20),
    db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings).where(inArray(platformSettings.key, keys)),
    isFeatureEnabled(db, "subscription_billing", true),
    db.select().from(tenantResourceAddons).where(eq(tenantResourceAddons.tenantId, tenantId)).orderBy(desc(tenantResourceAddons.endsAt)),
    db.select({ value: count() }).from(branches).where(eq(branches.tenantId, tenantId)),
    db.select({ value: count() }).from(inventoryWarehouses).where(eq(inventoryWarehouses.tenantId, tenantId)),
    db.select({ value: count() }).from(users).where(and(eq(users.tenantId, tenantId), ne(users.role, "super_admin"))),
    db.select({ value: count() }).from(users).where(and(eq(users.tenantId, tenantId), inArray(users.role, ["provider", "doctor", "specialist"]))),
  ]);
  const settingsMap = Object.fromEntries(settings.map(({ key, value }) => [key, value]));
  const plans = catalogRows.filter((plan) => classifyCatalogFeaturesJson(plan.featuresJson).kind === "plan").map((plan) => ({ ...plan, features: parseFeatures(plan.featuresJson) }));
  const addOns = catalogRows.flatMap((plan) => {
    const classification = classifyCatalogFeaturesJson(plan.featuresJson);
    return classification.kind === "addon" ? [{ id: plan.id, code: plan.code, nameAr: plan.nameAr, nameEn: plan.nameEn, billingCycle: plan.billingCycle, customDays: plan.customDays, priceMinor: plan.priceMinor, currency: plan.currency, resourceType: classification.resourceType }] : [];
  });
  const grants = resourceGrants as ResourceAddonGrant[];
  const [tenantPlanLimits] = tenant.platformPlanId ? await db.select({ maxUsers: platformPlans.maxUsers, maxBranches: platformPlans.maxBranches, maxWarehouses: platformPlans.maxWarehouses }).from(platformPlans).where(eq(platformPlans.id, tenant.platformPlanId)).limit(1) : [];
  const usage = {
    branch: getCombinedResourceUsage(tenantPlanLimits?.maxBranches ?? null, grants, "branch", branchCount[0]?.value ?? 0),
    warehouse: getCombinedResourceUsage(tenantPlanLimits?.maxWarehouses ?? null, grants, "warehouse", warehouseCount[0]?.value ?? 0),
    user: getCombinedResourceUsage(tenantPlanLimits?.maxUsers ?? null, grants, "user", userCount[0]?.value ?? 0),
    doctor: getAddonUsage(grants, "doctor", doctorCount[0]?.value ?? 0),
  };
  const now = new Date();
  const canPurchaseAddons = billingEnabled && tenant.status === "active" && Boolean(tenant.subscriptionEndsAt && tenant.subscriptionEndsAt.getTime() > now.getTime());
  return Response.json({
    billingEnabled,
    canPurchaseAddons,
    tenant: { id: tenant.id, name: tenant.name, status: tenant.status, trialStartedAt: tenant.trialStartedAt, trialEndsAt: tenant.trialEndsAt, subscriptionEndsAt: tenant.subscriptionEndsAt, platformPlanId: tenant.platformPlanId },
    settings: { trialDays: Number(settingsMap.trial_days ?? 30), graceDays: Number(settingsMap.grace_days ?? 3), vodafoneCashNumber: settingsMap["billing.vodafone_cash_number"] ?? "", instapayQrUrl: settingsMap["billing.instapay_qr_url"] ?? "", currency: settingsMap["billing.currency"] ?? "EGP" },
    plans, addOns, usage,
    resourceAddons: resourceGrants.map((grant) => ({ id: grant.id, resourceType: grant.resourceType, quantity: grant.quantity, startsAt: grant.startsAt, endsAt: grant.endsAt, active: grant.startsAt.getTime() <= now.getTime() && grant.endsAt.getTime() > now.getTime() })),
    requests, addonRequests, invoices,
  }, { headers: { "Cache-Control": "no-store" } });
}

function parseFeatures(value: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}
