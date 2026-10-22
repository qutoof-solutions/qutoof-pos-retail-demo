export type AnnualDiscountMode = "free_months" | "percent";

export type PlanDiscountSettings = {
  monthlyPercent: number;
  annualMode: AnnualDiscountMode;
  annualFreeMonths: number;
  annualPercent: number;
};

export const DEFAULT_PLAN_DISCOUNTS: PlanDiscountSettings = {
  monthlyPercent: 0,
  annualMode: "free_months",
  annualFreeMonths: 0,
  annualPercent: 0,
};

function boundedPercent(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}

export function readPlanDiscountSettings(values: Record<string, string | undefined>): PlanDiscountSettings {
  const mode = values["pricing.annual_discount_mode"] === "percent" ? "percent" : "free_months";
  const freeMonths = Number(values["pricing.annual_free_months"]);
  return {
    monthlyPercent: boundedPercent(values["pricing.monthly_discount_percent"], 0),
    annualMode: mode,
    annualFreeMonths: Number.isInteger(freeMonths) ? Math.min(11, Math.max(0, freeMonths)) : 0,
    annualPercent: boundedPercent(values["pricing.annual_discount_percent"], 0),
  };
}

export function discountedPlanPriceMinor(input: { priceMinor: number; billingCycle: string; monthlyPriceMinor?: number; settings: PlanDiscountSettings }): number {
  const { priceMinor, billingCycle, monthlyPriceMinor, settings } = input;
  if (billingCycle === "monthly") return Math.max(0, Math.round(priceMinor * (1 - settings.monthlyPercent / 100)));
  if (billingCycle !== "annual") return priceMinor;
  if (settings.annualMode === "free_months") {
    const monthly = monthlyPriceMinor ?? Math.round(priceMinor / 12);
    return Math.max(0, monthly * (12 - settings.annualFreeMonths));
  }
  return Math.max(0, Math.round(priceMinor * (1 - settings.annualPercent / 100)));
}

export function planDiscountLabel(settings: PlanDiscountSettings, language: "ar" | "en", billingCycle?: string): string | null {
  if (billingCycle === "monthly") {
    return settings.monthlyPercent > 0 ? (language === "ar" ? `خصم ${settings.monthlyPercent}%` : `${settings.monthlyPercent}% off`) : null;
  }
  if (billingCycle && billingCycle !== "annual") return null;
  if (settings.annualMode === "free_months" && settings.annualFreeMonths > 0) return language === "ar" ? `${settings.annualFreeMonths} شهور مجاناً` : `${settings.annualFreeMonths} months free`;
  if (settings.annualMode === "percent" && settings.annualPercent > 0) return language === "ar" ? `خصم ${settings.annualPercent}%` : `${settings.annualPercent}% off`;
  if (settings.monthlyPercent > 0) return language === "ar" ? `خصم ${settings.monthlyPercent}%` : `${settings.monthlyPercent}% off`;
  return null;
}
