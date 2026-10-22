import type { BillingCycle } from "@/lib/platform/catalog";

export type CatalogIdentity = { code?: string | null; nameEn: string; billingCycle?: BillingCycle | string };

/** Stable internal identity. Legacy rows used nameEn as their code. */
export function catalogCode(item: CatalogIdentity): string {
  return item.code?.trim() || item.nameEn.trim();
}

export function catalogBaseCode(item: CatalogIdentity): string {
  return catalogCode(item).replace(/_(monthly|quarterly|semi_annual|annual|custom_days(?:_\d+)?)$/, "");
}

export function slugifyCatalogCode(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "catalog_item";
}

export function defaultCatalogCode(nameEn: string, billingCycle: string, customDays?: number | null): string {
  const suffix = billingCycle === "custom_days" && customDays ? `custom_days_${customDays}` : billingCycle;
  return `${slugifyCatalogCode(nameEn)}_${suffix}`;
}
