import assert from "node:assert/strict";
import test from "node:test";
import { availableBillingCycles, billingCycleLabel, formatPlanLimit, isTrialDays, localizedPlanDescription, parsePublicPlans, parsePublicResourceAddons, planDiscountDisplay, preferredBillingCycle, recommendedPlanForIndustry, resourceAddonLabel, trialCtaLabel, type PublicPlan } from "../components/landing/marketing-types";

const plans: PublicPlan[] = [
  { nameAr: "باقة البداية التجارية", nameEn: "erp_starter", billingCycle: "monthly", customDays: null, priceMinor: 45000, currency: "EGP", features: { inventory: true, pos: true, reports: true }, limits: { branches: 1, warehouses: 1, users: 2 } },
  { nameAr: "باقة الجملة المتقدمة", nameEn: "erp_enterprise", billingCycle: "monthly", customDays: null, priceMinor: 220000, currency: "EGP", features: { inventory: true, pos: true, multi_warehouse: true, transfers: true }, limits: { branches: null, warehouses: null, users: 15 } },
  { nameAr: "باقة المركز الطبي", nameEn: "clinic_center", billingCycle: "monthly", customDays: null, priceMinor: 150000, currency: "EGP", features: { clinical: true, emr: true, qr_gate: true, medical_inventory: true }, limits: { branches: 4, warehouses: 2, users: 6 } },
];

test("public plans parsing keeps typed feature flags and database-backed integer limits", () => {
  const parsed = parsePublicPlans({ plans: [{ ...plans[0], descriptionAr: "وصف عربي", descriptionEn: "English plan details", features: { pos: true, internal_flag: "secret" } }] });
  assert.deepEqual(parsed?.[0].features, { pos: true });
  assert.deepEqual(parsed?.[0].limits, { branches: 1, warehouses: 1, users: 2 });
  assert.equal(parsed?.[0].descriptionAr, "وصف عربي");
  assert.equal(parsed?.[0].descriptionEn, "English plan details");
  const malformed = parsePublicPlans({ plans: [{ ...plans[0], limits: { branches: -1, warehouses: 1, users: 2 } }] });
  assert.equal(malformed?.[0].limits, null);
  assert.equal(parsePublicPlans({ error: "unavailable" }), null);
  assert.deepEqual(parsePublicPlans({ plans: [{ ...plans[0], billingCycle: "unknown_cycle" }] }), []);
});

test("plan descriptions remain in the selected locale and old responses safely show no description", () => {
  const plan = { descriptionAr: "  وصف الباقة بالعربية  ", descriptionEn: "  Detailed plan description  " };
  assert.equal(localizedPlanDescription(plan, "ar"), "وصف الباقة بالعربية");
  assert.equal(localizedPlanDescription(plan, "en"), "Detailed plan description");
  assert.equal(localizedPlanDescription({ descriptionAr: "وصف عربي", descriptionEn: "" }, "en"), "");
  const oldResponse = parsePublicPlans({ plans: [{ ...plans[0] }] });
  assert.equal(oldResponse?.[0].descriptionAr, "");
  assert.equal(oldResponse?.[0].descriptionEn, "");
});

test("public add-on parsing accepts only configured resource types and real billing cycles", () => {
  const payload = { addOns: [
    { id: "warehouse-monthly", nameAr: "مخزن إضافي", nameEn: "extra_warehouse_monthly", resourceType: "warehouse", billingCycle: "monthly", customDays: null, priceMinor: 12000, currency: "EGP" },
    { id: "branch-annual", nameAr: "فرع إضافي", nameEn: "extra_branch_annual", resourceType: "branch", billingCycle: "annual", customDays: null, priceMinor: 90000, currency: "EGP" },
    { id: "bad-addon", nameAr: "تالف", nameEn: "unknown", resourceType: "unknown", billingCycle: "monthly", priceMinor: 100, currency: "EGP" },
  ] };
  const parsed = parsePublicResourceAddons(payload);
  assert.deepEqual(parsed?.map((item) => [item.resourceType, item.billingCycle, item.priceMinor]), [["warehouse", "monthly", 12000], ["branch", "annual", 90000]]);
  assert.deepEqual(parsePublicResourceAddons({ plans: [] }), []);
  assert.equal(parsePublicResourceAddons({ addOns: "invalid" }), null);
});

test("cycle choices are derived from active catalog rows and preserve entered prices", () => {
  const annual = { ...plans[0]!, nameEn: "erp_starter_annual", billingCycle: "annual" as const, priceMinor: 420000 };
  const quarterly = { ...plans[1]!, billingCycle: "quarterly" as const };
  const available = availableBillingCycles([annual, plans[0]!, quarterly]);
  assert.deepEqual(available, ["monthly", "quarterly", "annual"]);
  assert.equal(preferredBillingCycle(available), "monthly");
  assert.equal(billingCycleLabel("annual", null, "ar"), "سنوي");
  assert.equal(billingCycleLabel("custom_days", 45, "en"), "Every 45 days");
  assert.equal(annual.priceMinor, 420000);
  assert.equal(resourceAddonLabel("doctor", "ar"), "طبيب إضافي");
  assert.equal(resourceAddonLabel("warehouse", "en"), "Extra warehouse");
});

test("the single plan discount display handles every billing cycle and locale", () => {
  const promotion = { priceMinor: 50_000, originalPriceMinor: 100_000, discountLabel: "Offer", discountLabelAr: "خصم", discountLabelEn: "Offer" };
  for (const billingCycle of ["monthly", "quarterly", "semi_annual", "annual", "custom_days"] as const) {
    assert.deepEqual(planDiscountDisplay({ billingCycle, ...promotion }, "ar"), { originalPriceMinor: 100_000, label: "خصم" });
    assert.deepEqual(planDiscountDisplay({ billingCycle, ...promotion }, "en"), { originalPriceMinor: 100_000, label: "Offer" });
  }
});

test("usage limits are read from the public plan payload and NULL means unlimited", () => {
  const parsed = parsePublicPlans({ plans: [{ ...plans[0], nameEn: "new_dynamic_plan", limits: { branches: null, warehouses: 7, users: 0 } }] });
  assert.deepEqual(parsed?.[0]?.limits, { branches: null, warehouses: 7, users: 0 });
  assert.equal(formatPlanLimit(3, "ar", "غير محدد"), "3");
  assert.equal(formatPlanLimit(null, "ar", "غير محدد"), "غير محدود");
  assert.equal(formatPlanLimit(null, "en", "Not specified"), "Unlimited");
  assert.equal(formatPlanLimit(undefined, "en", "Not specified"), "Not specified");
  const malformed = parsePublicPlans({ plans: [{ ...plans[0], limits: { branches: -1, warehouses: 1, users: 2 } }] });
  assert.equal(malformed?.[0]?.limits, null);
});

test("trial CTA uses the API-supplied days and has a safe generic fallback", () => {
  assert.equal(isTrialDays(25), true);
  assert.equal(isTrialDays(0), false);
  assert.equal(trialCtaLabel("en", 25), "Start your 25-day free trial");
  assert.equal(trialCtaLabel("en", null), "Start your free trial");
  assert.match(trialCtaLabel("ar", 25), /25|٢٥/);
});

test("industry recommendations require the configured POS, warehouse, or EMR capabilities", () => {
  assert.equal(recommendedPlanForIndustry(plans, "retail")?.nameEn, "erp_starter");
  assert.equal(recommendedPlanForIndustry(plans, "restaurant")?.nameEn, "erp_starter");
  assert.equal(recommendedPlanForIndustry(plans, "gym")?.nameEn, "erp_starter");
  assert.equal(recommendedPlanForIndustry(plans, "wholesale")?.nameEn, "erp_enterprise");
  assert.equal(recommendedPlanForIndustry(plans, "clinic")?.nameEn, "clinic_center");
});
