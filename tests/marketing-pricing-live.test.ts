import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadPublicPricing } from "../components/landing/use-public-pricing";
import { availableBillingCycles, parsePublicPlans, parsePublicResourceAddons } from "../components/landing/marketing-types";

const limits = { branches: 1, warehouses: 1, users: 2 } as const;

function plan(overrides: Record<string, unknown>) {
  return {
    nameAr: "باقة منشورة",
    nameEn: "live_plan",
    activityCode: "retail",
    billingCycle: "monthly",
    customDays: null,
    priceMinor: 100000,
    currency: "EGP",
    features: { pos: true },
    limits,
    ...overrides,
  };
}

function mockFetch(plansPayload: unknown, settingsPayload: unknown = { trialDays: 30 }) {
  const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    if (String(input) === "/api/public/plans") return new Response(JSON.stringify(plansPayload), { status: 200 });
    if (String(input) === "/api/public/settings") return new Response(JSON.stringify(settingsPayload), { status: 200 });
    throw new Error(`unexpected endpoint: ${String(input)}`);
  };
  return { calls, fetcher };
}

test("live loader requests both APIs and returns changing catalog data without fallback", async () => {
  const firstPayload = {
    plans: [
      plan({ billingCycle: "monthly", priceMinor: 125000, originalPriceMinor: 150000, discountLabelAr: "خصم الإطلاق", discountLabelEn: "Launch discount" }),
      plan({ billingCycle: "quarterly", priceMinor: 330000, originalPriceMinor: 375000, discountLabelAr: "خصم ربع سنوي", discountLabelEn: "Quarterly discount" }),
      plan({ billingCycle: "annual", priceMinor: 1180000, originalPriceMinor: 1500000, discountLabelAr: "خصم سنوي", discountLabelEn: "Annual discount" }),
    ],
    addOns: [{ id: "warehouse-annual", nameAr: "مخزن إضافي", nameEn: "Extra warehouse", resourceType: "warehouse", billingCycle: "annual", customDays: null, priceMinor: 90000, currency: "EGP" }],
  };
  const firstMock = mockFetch(firstPayload, { trialDays: 21 });
  const firstSignal = new AbortController().signal;
  const first = await loadPublicPricing(firstMock.fetcher, firstSignal);

  assert.deepEqual(firstMock.calls.map(({ input }) => input), ["/api/public/plans", "/api/public/settings"]);
  assert.equal(firstMock.calls.length, 2);
  for (const { init } of firstMock.calls) {
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, firstSignal);
  }
  assert.equal(first.trialDays, 21);
  assert.deepEqual(availableBillingCycles(first.plans), ["monthly", "quarterly", "annual"]);
  assert.deepEqual(first.plans.map((item) => item.priceMinor), [125000, 330000, 1180000]);
  assert.deepEqual(first.plans.map((item) => item.originalPriceMinor), [150000, 375000, 1500000]);
  assert.deepEqual(first.plans.map((item) => item.discountLabelEn), ["Launch discount", "Quarterly discount", "Annual discount"]);
  assert.equal(first.plans[0]?.discountLabelAr, "خصم الإطلاق");
  assert.equal(first.addOns[0]?.priceMinor, 90000);
  assert.equal(first.addOns[0]?.billingCycle, "annual");

  const secondPayload = {
    plans: [
      plan({ billingCycle: "monthly", priceMinor: 145000, discountLabelEn: "Spring offer" }),
      plan({ billingCycle: "quarterly", priceMinor: 360000, discountLabelEn: "Quarterly offer" }),
      plan({ billingCycle: "annual", priceMinor: 1290000, discountLabelEn: "Annual offer" }),
    ],
    addOns: [{ id: "doctor-monthly", nameAr: "طبيب إضافي", nameEn: "Extra doctor", resourceType: "doctor", billingCycle: "monthly", customDays: null, priceMinor: 25000, currency: "EGP" }],
  };
  const second = await loadPublicPricing(mockFetch(secondPayload, { trialDays: 45 }).fetcher, new AbortController().signal);
  assert.deepEqual(second.plans.map((item) => item.priceMinor), [145000, 360000, 1290000]);
  assert.deepEqual(second.plans.map((item) => item.discountLabelEn), ["Spring offer", "Quarterly offer", "Annual offer"]);
  assert.notDeepEqual(second.plans.map((item) => item.priceMinor), first.plans.map((item) => item.priceMinor));
  assert.equal(second.addOns[0]?.priceMinor, 25000);
  assert.equal(second.addOns[0]?.resourceType, "doctor");
  assert.equal(second.trialDays, 45);
});

test("invalid live payloads are rejected instead of receiving hardcoded pricing", async () => {
  const invalidPlans = mockFetch({ plans: "not-an-array", addOns: [] });
  await assert.rejects(() => loadPublicPricing(invalidPlans.fetcher), /public pricing unavailable/);

  const validPlans = { plans: [plan({ priceMinor: 123000 })], addOns: [] };
  const invalidSettings = mockFetch(validPlans, { trialDays: "30" });
  await assert.rejects(() => loadPublicPricing(invalidSettings.fetcher), /public pricing unavailable/);

  assert.equal(parsePublicPlans({ error: "unavailable" }), null);
  assert.equal(parsePublicResourceAddons({ addOns: "not-an-array" }), null);
});

test("pricing cards keep equal-height wrappers and bottom-aligned actions", () => {
  const source = readFileSync("components/landing/pricing-section.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(source, /<ScrollReveal[^>]+className="h-full"[^>]+delay=\{index \* 80\}/);
  assert.match(source, /landing-plan-card[^\"]*\bh-full\b/);
  assert.match(source, /marketing-primary-action[^\"]*\bmt-auto\b/);
  assert.match(source, /grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(css, /marketing-shell-light \.pricing-page \[role="group"\]/);
});

test("pricing cards render the locale-matched plan description as plain customer-provided text", () => {
  const source = readFileSync("components/landing/pricing-section.tsx", "utf8");
  assert.match(source, /localizedPlanDescription\(plan, language\)/);
  assert.match(source, /<p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-300">\{description\}<\/p>/);
});

test("pricing cards show DB-backed usage limits separately from registered plan features", () => {
  const source = readFileSync("components/landing/pricing-section.tsx", "utf8");
  assert.match(source, /Object\.entries\(plan\.features\)/);
  assert.match(source, /Object\.entries\(plan\.features\)[\s\S]*?branches.*users.*warehouses/);
  assert.match(source, /limitRows\.map/);
  assert.match(source, /featuresIncluded/);
  assert.doesNotMatch(source, /inheritedCommercialPlanFeatures|commercialPlanTierLabel/);
  assert.match(source, /t\("includedSupportNote"\)/);
});

test("the shared public marketing shell keeps the WhatsApp sales widget fixed outside its relative wrapper", () => {
  const source = readFileSync("components/landing/marketing-shell.tsx", "utf8");
  assert.match(source, /<WhatsAppWidget language=\{locale\} hideOnScroll=\{false\} \/>/);
  const widgetIndex = source.indexOf("<WhatsAppWidget language={locale} hideOnScroll={false} />");
  assert.ok(widgetIndex >= 0);
  assert.match(source.slice(widgetIndex), /^<WhatsAppWidget language=\{locale\} hideOnScroll=\{false\} \/>\s*<\/>\s*\);/);
  const widget = readFileSync("components/landing/whatsapp-widget.tsx", "utf8");
  assert.match(widget, /className=\{`fixed bottom-4 z-40/);
});
