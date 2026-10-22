import type { MarketingPlanLimits } from "@/lib/platform/marketing-plan-limits";
import { BILLING_CYCLES, RESOURCE_ADDON_TYPES, type BillingCycle, type ResourceAddonType } from "@/lib/platform/catalog";
import { resolveActivityCode, type ActivityCode } from "@/lib/platform/activity-contract";
import type { IndustryKind, LandingLanguage } from "./product-mockups";

export type PublicPlan = {
  activityCode?: ActivityCode;
  nameAr: string;
  code?: string | null;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  billingCycle: BillingCycle;
  customDays: number | null;
  priceMinor: number;
  originalPriceMinor?: number;
  discountLabel?: string | null;
  discountLabelAr?: string | null;
  discountLabelEn?: string | null;
  currency: string;
  features: Record<string, boolean>;
  limits: MarketingPlanLimits | null;
};

export type PublicResourceAddon = {
  id: string;
  code?: string | null;
  nameAr: string;
  nameEn: string;
  billingCycle: BillingCycle;
  customDays: number | null;
  priceMinor: number;
  currency: string;
  resourceType: ResourceAddonType;
};

export type PlanLoadState = {
  status: "loading" | "ready" | "error";
  plans: PublicPlan[];
  addOns: PublicResourceAddon[];
};

function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

function isResourceAddonType(value: unknown): value is ResourceAddonType {
  return typeof value === "string" && (RESOURCE_ADDON_TYPES as readonly string[]).includes(value);
}

function parseCycleFields(record: Record<string, unknown>): { billingCycle: BillingCycle; customDays: number | null } | null {
  if (!isBillingCycle(record.billingCycle)) return null;
  const customDays = typeof record.customDays === "number" && Number.isInteger(record.customDays) && record.customDays > 0 ? record.customDays : null;
  if (record.billingCycle === "custom_days" && customDays === null) return null;
  return { billingCycle: record.billingCycle, customDays: record.billingCycle === "custom_days" ? customDays : null };
}

function parsePriceFields(record: Record<string, unknown>): { nameAr: string; nameEn: string; priceMinor: number; currency: string } | null {
  if (typeof record.nameAr !== "string" || typeof record.nameEn !== "string"
    || typeof record.priceMinor !== "number" || !Number.isSafeInteger(record.priceMinor) || record.priceMinor < 0
    || typeof record.currency !== "string" || !/^[A-Z]{3}$/.test(record.currency)) return null;
  return { nameAr: record.nameAr, nameEn: record.nameEn, priceMinor: record.priceMinor, currency: record.currency };
}

function isPlanLimit(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function parseMarketingLimits(value: unknown): MarketingPlanLimits | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const limits = value as Record<string, unknown>;
  if (!isPlanLimit(limits.branches) || !isPlanLimit(limits.warehouses) || !isPlanLimit(limits.users)) return null;
  return { branches: limits.branches, warehouses: limits.warehouses, users: limits.users };
}

export function parsePublicPlans(value: unknown): PublicPlan[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { plans?: unknown }).plans)) return null;
  return ((value as { plans: unknown[] }).plans).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const plan = candidate as Record<string, unknown>;
    const priceFields = parsePriceFields(plan);
    const cycleFields = parseCycleFields(plan);
    if (!priceFields || !cycleFields) return [];
    const rawFeatures = plan.features && typeof plan.features === "object" && !Array.isArray(plan.features) ? plan.features as Record<string, unknown> : {};
    const features = Object.fromEntries(Object.entries(rawFeatures).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
    return [{ ...priceFields, ...cycleFields, descriptionAr: typeof plan.descriptionAr === "string" ? plan.descriptionAr : "", descriptionEn: typeof plan.descriptionEn === "string" ? plan.descriptionEn : "", activityCode: resolveActivityCode(plan.activityCode), originalPriceMinor: typeof plan.originalPriceMinor === "number" ? plan.originalPriceMinor : undefined, discountLabel: typeof plan.discountLabel === "string" ? plan.discountLabel : null, discountLabelAr: typeof plan.discountLabelAr === "string" ? plan.discountLabelAr : null, discountLabelEn: typeof plan.discountLabelEn === "string" ? plan.discountLabelEn : null, features, limits: parseMarketingLimits(plan.limits) }];
  });
}

export function parsePublicResourceAddons(value: unknown): PublicResourceAddon[] | null {
  if (!value || typeof value !== "object") return null;
  const source = value as { addOns?: unknown };
  if (source.addOns === undefined) return [];
  if (!Array.isArray(source.addOns)) return null;
  return source.addOns.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const addon = candidate as Record<string, unknown>;
    const priceFields = parsePriceFields(addon);
    const cycleFields = parseCycleFields(addon);
    if (typeof addon.id !== "string" || addon.id.length < 1 || addon.id.length > 64 || !priceFields || !cycleFields || !isResourceAddonType(addon.resourceType)) return [];
    return [{ ...priceFields, ...cycleFields, id: addon.id, resourceType: addon.resourceType }];
  });
}

const BILLING_CYCLE_ORDER: readonly BillingCycle[] = ["monthly", "quarterly", "semi_annual", "annual", "custom_days"];

export function availableBillingCycles(plans: PublicPlan[]): BillingCycle[] {
  const existing = new Set(plans.map((plan) => plan.billingCycle));
  return BILLING_CYCLE_ORDER.filter((cycle) => existing.has(cycle));
}

export function preferredBillingCycle(cycles: BillingCycle[]): BillingCycle | null {
  return BILLING_CYCLE_ORDER.find((cycle) => cycles.includes(cycle)) ?? null;
}
export function planDiscountDisplay(
  plan: Pick<PublicPlan, "billingCycle" | "priceMinor" | "originalPriceMinor" | "discountLabel" | "discountLabelAr" | "discountLabelEn">,
  language: LandingLanguage,
): { originalPriceMinor: number | null; label: string | null } {
  const rawLabel = language === "ar" ? plan.discountLabelAr ?? plan.discountLabel : plan.discountLabelEn ?? plan.discountLabel;
  return {
    originalPriceMinor: plan.originalPriceMinor !== undefined && plan.originalPriceMinor > plan.priceMinor ? plan.originalPriceMinor : null,
    label: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : null,
  };
}

export function billingCycleLabel(cycle: BillingCycle, customDays: number | null, language: LandingLanguage): string {
  if (cycle === "monthly") return language === "ar" ? "شهري" : "Monthly";
  if (cycle === "quarterly") return language === "ar" ? "ربع سنوي" : "Quarterly";
  if (cycle === "semi_annual") return language === "ar" ? "نصف سنوي" : "Semiannual";
  if (cycle === "annual") return language === "ar" ? "سنوي" : "Annual";
  if (customDays === null) return language === "ar" ? "مدة مخصصة" : "Custom duration";
  const days = new Intl.NumberFormat("en-US", { useGrouping: false }).format(customDays);
  return language === "ar" ? `كل ${days} يومًا` : `Every ${days} days`;
}

export function resourceAddonLabel(type: ResourceAddonType, language: LandingLanguage): string {
  const labels: Record<ResourceAddonType, Record<LandingLanguage, string>> = {
    warehouse: { ar: "مخزن إضافي", en: "Extra warehouse" },
    branch: { ar: "فرع إضافي", en: "Extra branch" },
    user: { ar: "مستخدم إضافي", en: "Extra user" },
    doctor: { ar: "طبيب إضافي", en: "Extra doctor" },
  };
  return labels[type][language];
}

export function formatPlanLimit(value: number | null | undefined, language: LandingLanguage, unspecified: string): string {
  if (value === undefined) return unspecified;
  if (value === null) return language === "ar" ? "غير محدود" : "Unlimited";
  return new Intl.NumberFormat("en-US", { useGrouping: false }).format(value);
}

export function localizedPlanDescription(plan: Pick<PublicPlan, "descriptionAr" | "descriptionEn">, language: LandingLanguage): string {
  const description = language === "ar" ? plan.descriptionAr : plan.descriptionEn;
  return typeof description === "string" ? description.trim() : "";
}

const FEATURE_LABELS: Record<string, [string, string]> = {
  appointments: ["المواعيد والحجوزات", "Appointments and bookings"],
  attendance: ["الحضور والانصراف", "Attendance and time tracking"],
  branches: ["إدارة الفروع", "Branch management"],
  cashier: ["نظام الكاشير", "Cashier system"],
  clinic: ["إدارة العيادات", "Clinic management"],
  clinical: ["إدارة العمليات الطبية", "Clinical operations"],
  commissions: ["العمولات", "Commissions"],
  customers: ["إدارة العملاء", "Customer management"],
  emr: ["السجل الطبي والملفات", "Medical records (EMR)"],
  expenses: ["المصروفات", "Expenses"],
  gym: ["إدارة الجيم والنوادي", "Gym and club management"],
  gym_memberships: ["اشتراكات الجيم والنوادي", "Gym and club memberships"],
  hospital: ["إدارة المستشفيات الصغيرة", "Small hospital management"],
  hospital_management: ["إدارة المستشفيات الصغيرة", "Small hospital management"],
  inventory: ["إدارة المخزون", "Inventory management"],
  invoices: ["الفواتير", "Invoicing"],
  installments: ["التقسيط والتحصيل", "Installments and collections"],
  medical_inventory: ["مخزون طبي", "Medical inventory"],
  memberships: ["الاشتراكات والتجديدات", "Memberships and renewals"],
  multi_warehouse: ["إدارة أكثر من مخزن", "Multi-warehouse management"],
  pos: ["نقطة البيع والكاشير POS", "Point of sale and cashier (POS)"],
  prescriptions: ["الوصفات الطبية", "Prescriptions"],
  public_booking: ["الحجز الإلكتروني العام", "Public online booking"],
  purchases: ["المشتريات", "Purchasing"],
  qr_gate: ["بوابة QR للحجوزات", "QR booking gate"],
  reports: ["التقارير", "Reports and analytics"],
  restaurants: ["إدارة المطاعم والكافيهات", "Restaurant and café management"],
  services: ["إدارة الخدمات", "Service management"],
  suppliers: ["إدارة الموردين", "Supplier management"],
  treasury: ["الخزينة والورديات", "Treasury and shifts"],
  transfers: ["تحويلات المخزون بين المخازن", "Inventory transfers"],
  warehouse: ["إدارة المخازن", "Warehouse management"],
  whatsapp: ["تكامل WhatsApp", "WhatsApp integration"],
};

function humanizeFeatureKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function planFeatureLabel(key: string, language: LandingLanguage): string {
  const labels = FEATURE_LABELS[key.toLowerCase()];
  if (labels) return language === "ar" ? labels[0] : labels[1];
  return language === "ar" ? `ميزة: ${humanizeFeatureKey(key)}` : humanizeFeatureKey(key);
}

export function isTrialDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 180;
}

export function trialCtaLabel(language: LandingLanguage, days: number | null): string {
  if (language === "ar") {
    if (days === null) return "ابدأ تجربتك المجانية";
    const formattedDays = new Intl.NumberFormat("en-US", { useGrouping: false }).format(days);
    return `ابدأ تجربتك المجانية لمدة ${formattedDays} يومًا`;
  }
  return days === null ? "Start your free trial" : `Start your ${days}-day free trial`;
}

export function recommendedPlanForIndustry(plans: PublicPlan[], industry: IndustryKind): PublicPlan | null {
  const matches = plans.filter((plan) => {
    if (industry === "wholesale") return plan.features.multi_warehouse === true && plan.features.transfers === true;
    if (industry === "clinic") return plan.features.emr === true && plan.features.qr_gate === true;
    return plan.features.pos === true && plan.features.inventory === true;
  });
  const cycleOrder = new Map(BILLING_CYCLE_ORDER.map((cycle, index) => [cycle, index]));
  return [...matches].sort((a, b) => (cycleOrder.get(a.billingCycle) ?? 99) - (cycleOrder.get(b.billingCycle) ?? 99) || a.priceMinor - b.priceMinor)[0] ?? null;
}

export function planAudience(plan: PublicPlan, language: LandingLanguage): string {
  if (plan.activityCode === "medical" || plan.features.emr || plan.features.clinical) {
    return language === "ar" ? "للعيادات والمراكز الطبية" : "For clinics and medical centers";
  }
  if (plan.activityCode === "wholesale" || plan.features.multi_warehouse) {
    return language === "ar" ? "للجملة والتوزيع والمخازن" : "For wholesale and multi-warehouse teams";
  }
  if (plan.activityCode === "restaurant") {
    return language === "ar" ? "للمطاعم والأنشطة الغذائية" : "For restaurants and food businesses";
  }
  if (plan.activityCode === "beauty") {
    return language === "ar" ? "لمراكز التجميل والخدمات الشخصية" : "For beauty and personal-care teams";
  }
  if (plan.activityCode === "sports") {
    return language === "ar" ? "للنوادي والأنشطة الرياضية" : "For gyms and sports businesses";
  }
  if (plan.activityCode === "consulting") {
    return language === "ar" ? "للخدمات المهنية والاستشارية" : "For consulting and professional services";
  }
  if (plan.features.pos && plan.features.inventory) return language === "ar" ? "للمحلات والمخازن" : "For shops and inventory teams";
  return language === "ar" ? "للأنشطة التشغيلية" : "For operations teams";
}
