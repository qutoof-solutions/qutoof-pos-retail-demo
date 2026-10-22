import test from "node:test";
import assert from "node:assert/strict";
import { addBillingCycle, deriveTenantBillingStatus, normalizeFeatureKey, safeTrialDays } from "../lib/platform/billing";
import { planFeatureGranted } from "../lib/platform/features";
import { isAllowedBillingAdmin } from "../lib/platform/telegram";

const baseTime = new Date("2026-10-08T10:00:00.000Z");

test("trial, subscription, grace and expired states follow the configured boundaries", () => {
  assert.equal(deriveTenantBillingStatus({ status: "pending_trial", trialEndsAt: null, subscriptionEndsAt: null }, baseTime), "pending_trial");
  assert.equal(deriveTenantBillingStatus({ status: "active_trial", trialEndsAt: new Date("2026-10-10T10:00:00.000Z"), subscriptionEndsAt: null }, baseTime), "active_trial");
  assert.equal(deriveTenantBillingStatus({ status: "active_trial", trialEndsAt: new Date("2026-10-07T10:00:00.000Z"), subscriptionEndsAt: null }, baseTime), "grace");
  assert.equal(deriveTenantBillingStatus({ status: "grace", trialEndsAt: new Date("2026-10-05T10:00:00.000Z"), subscriptionEndsAt: null }, baseTime), "expired");
  assert.equal(deriveTenantBillingStatus({ status: "active", trialEndsAt: null, subscriptionEndsAt: new Date("2026-11-08T10:00:00.000Z") }, baseTime), "active");
  assert.equal(deriveTenantBillingStatus({ status: "frozen", trialEndsAt: null, subscriptionEndsAt: new Date("2026-11-08T10:00:00.000Z") }, baseTime), "frozen");
});

test("grace period boundary is exclusive and custom grace values are respected", () => {
  const tenant = { status: "active" as const, trialEndsAt: null, subscriptionEndsAt: new Date("2026-10-06T10:00:00.000Z") };
  assert.equal(deriveTenantBillingStatus(tenant, baseTime, 3), "grace");
  assert.equal(deriveTenantBillingStatus(tenant, new Date("2026-10-09T10:00:00.000Z"), 3), "expired");
  assert.equal(deriveTenantBillingStatus(tenant, baseTime, 1), "expired");
});

test("billing cycles preserve month-end safely and support explicit durations", () => {
  assert.equal(addBillingCycle(new Date("2026-01-31T00:00:00.000Z"), "monthly").toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(addBillingCycle(new Date("2024-01-31T00:00:00.000Z"), "monthly").toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(addBillingCycle(new Date("2026-01-31T00:00:00.000Z"), "quarterly").toISOString(), "2026-04-30T00:00:00.000Z");
  assert.equal(addBillingCycle(new Date("2026-01-01T00:00:00.000Z"), "custom_days", 30).toISOString(), "2026-01-31T00:00:00.000Z");
  assert.throws(() => addBillingCycle(baseTime, "custom_days", 0), RangeError);
});

test("settings and feature keys are bounded and normalized", () => {
  assert.equal(safeTrialDays("45"), 45);
  assert.equal(safeTrialDays("181"), 30);
  assert.equal(safeTrialDays("invalid"), 30);
  assert.equal(normalizeFeatureKey("  WhatsApp-Plus  "), "whatsapp_plus");
});

test("plan entitlements require an explicit true value for paid modules", () => {
  assert.equal(planFeatureGranted('{"public_booking":true,"whatsapp":false}', "public_booking"), true);
  assert.equal(planFeatureGranted('{"public_booking":true,"whatsapp":false}', "whatsapp"), false);
  assert.equal(planFeatureGranted('{"public_booking":true}', "pos"), false);
  assert.equal(planFeatureGranted("not-json", "public_booking"), false);
});

test("Telegram billing decisions are restricted to the configured owner chat and sender", () => {
  assert.equal(isAllowedBillingAdmin({ chatId: "100", chatType: "private", senderId: "100" }, "100"), true);
  assert.equal(isAllowedBillingAdmin({ chatId: "100", chatType: "group", senderId: "100" }, "100"), false);
  assert.equal(isAllowedBillingAdmin({ chatId: "100", chatType: "private", senderId: "101" }, "100", "101"), true);
  assert.equal(isAllowedBillingAdmin({ chatId: "100", chatType: "private", senderId: "102" }, "100", "101"), false);
  assert.equal(isAllowedBillingAdmin({ chatId: "999", chatType: "private", senderId: "100" }, "100"), false);
});
