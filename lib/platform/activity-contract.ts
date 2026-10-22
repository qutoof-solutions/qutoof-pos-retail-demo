import { VERTICALS, type Vertical } from "@/lib/terms";

/** Canonical activity identifier shared by tenant context and plan feature payloads. */
export type ActivityCode = Vertical;
export const ACTIVITY_CODES = VERTICALS;

export type ActivityCarrier = {
  activityCode?: unknown;
  vertical?: unknown;
};

export function resolveActivityCode(value: unknown, fallback: ActivityCode = "retail"): ActivityCode {
  return typeof value === "string" && (ACTIVITY_CODES as readonly string[]).includes(value) ? value as ActivityCode : fallback;
}

/** Prefer the new activityCode field while accepting legacy vertical rows and payloads. */
export function activityCodeFromCarrier(carrier: ActivityCarrier | null | undefined, fallback: ActivityCode = "retail"): ActivityCode {
  return resolveActivityCode(carrier?.activityCode, resolveActivityCode(carrier?.vertical, fallback));
}

export function activityCodeFromPlanCode(code: string | null | undefined, fallback: ActivityCode = "retail"): ActivityCode {
  const normalized = (code ?? "").trim().toLowerCase();
  if (normalized.startsWith("clinic_")) return "medical";
  if (normalized.startsWith("beauty_")) return "beauty";
  if (normalized.startsWith("gym_") || normalized.startsWith("sports_")) return "sports";
  if (normalized.startsWith("consulting_")) return "consulting";
  if (normalized.startsWith("wholesale_") || normalized.startsWith("distribution_")) return "wholesale";
  if (normalized.startsWith("restaurant_") || normalized.startsWith("cafe_")) return "restaurant";
  if (normalized.startsWith("erp_")) return "retail";
  return fallback;
}

export type PlanFeatureContract = {
  activityCode: ActivityCode;
  features: Record<string, boolean>;
};

/**
 * Reads the one plan/features contract. Metadata is intentionally not an entitlement;
 * malformed JSON and unknown activity codes use the supplied safe fallback.
 */
export function resolvePlanFeatureContract(input: {
  featuresJson?: string | null;
  activityCode?: unknown;
  vertical?: unknown;
  fallbackActivityCode?: ActivityCode;
  fallbackFeatures?: Record<string, boolean>;
}): PlanFeatureContract {
  const features: Record<string, boolean> = { ...(input.fallbackFeatures ?? {}) };
  try {
    const parsed: unknown = JSON.parse(input.featuresJson ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") features[key] = value;
      }
    }
  } catch {
    // Keep the explicit fallback features for legacy or malformed catalog rows.
  }
  return {
    activityCode: activityCodeFromCarrier({ activityCode: input.activityCode, vertical: input.vertical }, input.fallbackActivityCode),
    features,
  };
}
