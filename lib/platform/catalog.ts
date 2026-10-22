export const BILLING_CYCLES = ["monthly", "quarterly", "semi_annual", "annual", "custom_days"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const RESOURCE_ADDON_TYPES = ["warehouse", "branch", "user", "doctor"] as const;
export type ResourceAddonType = (typeof RESOURCE_ADDON_TYPES)[number];

export const RESOURCE_ADDON_MARKERS: Record<ResourceAddonType, string> = {
  warehouse: "catalog_addon_warehouse",
  branch: "catalog_addon_branch",
  user: "catalog_addon_user",
  doctor: "catalog_addon_doctor",
};

function normalizePlanCode(nameEn: string): string {
  return nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/_(monthly|quarterly|semi_annual|annual|custom_days(?:_\d+)?)$/, "");
}

export function catalogIdentityCode(item: { code?: string | null; nameEn: string }): string { return item.code?.trim() || item.nameEn; }

export function withCatalogFeatureDefaults(nameEn: string, features: Record<string, boolean>, internalCode?: string | null): Record<string, boolean> {
  const code = normalizePlanCode(internalCode || nameEn);
  return code === "clinic_center" || code === "clinic_hospital" ? { ...features, pos: true } : features;
}

export function isOfficialWhatsAppPlan(nameEn: string, internalCode?: string | null): boolean {
  return ["erp_pro", "erp_enterprise", "clinic_center", "clinic_hospital"].includes(normalizePlanCode(internalCode || nameEn));
}

export type CatalogClassification =
  | { kind: "plan" }
  | { kind: "addon"; resourceType: ResourceAddonType }
  | { kind: "invalid_addon" };

export type BasePlanCandidate = {
  id: string;
  nameAr: string;
  featuresJson: string | null | undefined;
};

export type BasePlanSelection =
  | { ok: true; plan: BasePlanCandidate }
  | { ok: false; reason: "missing" | "addon" | "invalid_addon" };

export function classifyCatalogFeatures(features: Record<string, unknown>): CatalogClassification {
  const markerKeys = Object.values(RESOURCE_ADDON_MARKERS).filter((key) => Object.hasOwn(features, key));
  if (markerKeys.length === 0) return { kind: "plan" };
  const enabled = RESOURCE_ADDON_TYPES.filter((type) => features[RESOURCE_ADDON_MARKERS[type]] === true);
  return markerKeys.length === 1 && enabled.length === 1
    ? { kind: "addon", resourceType: enabled[0]! }
    : { kind: "invalid_addon" };
}

export function parseCatalogFeatures(featuresJson: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(featuresJson ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function classifyCatalogFeaturesJson(featuresJson: string | null | undefined): CatalogClassification {
  return classifyCatalogFeatures(parseCatalogFeatures(featuresJson));
}

/** Base-plan assignment must never accept a resource add-on row. */
export function validateBasePlanSelection(plan: BasePlanCandidate | null | undefined): BasePlanSelection {
  if (!plan) return { ok: false, reason: "missing" };
  const classification = classifyCatalogFeaturesJson(plan.featuresJson);
  if (classification.kind === "plan") return { ok: true, plan };
  return { ok: false, reason: classification.kind };
}

export function addResourceAddonMarker(features: Record<string, boolean>, resourceType: ResourceAddonType | null): Record<string, boolean> {
  const cleaned = Object.fromEntries(
    Object.entries(features).filter(([key]) => !Object.values(RESOURCE_ADDON_MARKERS).includes(key)),
  );
  return resourceType ? { ...cleaned, [RESOURCE_ADDON_MARKERS[resourceType]]: true } : cleaned;
}

export function stripResourceAddonMarkers(features: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(features).filter(([key]) => !Object.values(RESOURCE_ADDON_MARKERS).includes(key)),
  );
}
