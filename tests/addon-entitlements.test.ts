import assert from "node:assert/strict";
import test from "node:test";
import { calculateAddonAmountMinor, getAddonResourceLimit, getAddonUsage, getCombinedResourceLimit, getCombinedResourceUsage, isProviderSeat, type ResourceAddonGrant } from "../lib/platform/addon-entitlements";

const now = new Date("2026-10-01T00:00:00.000Z");
const cycleEnd = new Date("2026-11-01T00:00:00.000Z");

function grant(overrides: Partial<ResourceAddonGrant>): ResourceAddonGrant {
  return { resourceType: "warehouse", quantity: 1, baselineCount: 2, baselineUserCount: 4, startsAt: now, endsAt: cycleEnd, ...overrides };
}

test("addon prices are prorated by remaining subscription time and quantity", () => {
  assert.equal(calculateAddonAmountMinor({ unitPriceMinor: 15000, quantity: 2, billingCycle: "monthly", subscriptionEndsAt: cycleEnd, now }), 30000);
  assert.equal(calculateAddonAmountMinor({ unitPriceMinor: 15000, quantity: 1, billingCycle: "monthly", subscriptionEndsAt: new Date("2026-10-16T12:00:00.000Z"), now }), 7500);
  assert.throws(() => calculateAddonAmountMinor({ unitPriceMinor: 0, quantity: 1, billingCycle: "monthly", subscriptionEndsAt: cycleEnd, now }), RangeError);
  assert.throws(() => calculateAddonAmountMinor({ unitPriceMinor: 100, quantity: 26, billingCycle: "monthly", subscriptionEndsAt: cycleEnd, now }), RangeError);
});

test("active resource grants accumulate while no grant means no addon-specific cap", () => {
  const grants = [grant({ quantity: 1 }), grant({ quantity: 2, startsAt: new Date("2026-10-02T00:00:00.000Z") })];
  assert.equal(getAddonResourceLimit(grants, "warehouse", now), 3);
  assert.equal(getAddonResourceLimit([], "branch", now), null);
  assert.deepEqual(getAddonUsage(grants, "warehouse", 2, now), { limit: 3, used: 2, available: 1 });
});

test("expired capacity returns to the captured baseline; active doctor grants add both doctor and user seats", () => {
  const expired = grant({ resourceType: "branch", quantity: 5, baselineCount: 3, endsAt: new Date("2026-09-30T23:59:59.000Z") });
  assert.equal(getAddonResourceLimit([expired], "branch", now), 3);
  const doctorGrant = grant({ resourceType: "doctor", quantity: 2, baselineCount: 1, baselineUserCount: 4 });
  assert.equal(getAddonResourceLimit([doctorGrant], "doctor", now), 3);
  assert.equal(getAddonResourceLimit([doctorGrant], "user", now), 6);
});

test("base plan caps add active add-on quantities and grandfather only pre-existing usage", () => {
  const active = [grant({ quantity: 2, baselineCount: 2 })];
  assert.equal(getCombinedResourceLimit(2, active, "warehouse", now), 4);
  assert.equal(getCombinedResourceLimit(5, active, "warehouse", now), 7);
  assert.equal(getCombinedResourceLimit(5, [grant({ quantity: 2, baselineCount: 8 })], "warehouse", now), 10);
  assert.equal(getCombinedResourceLimit(5, [grant({ quantity: 2, baselineCount: 2, endsAt: new Date("2026-09-30T23:59:59.000Z") })], "warehouse", now), 5);
  assert.equal(getCombinedResourceLimit(null, active, "warehouse", now), null);
  assert.deepEqual(getCombinedResourceUsage(3, active, "warehouse", 4, now), { baseLimit: 3, addonQuantity: 2, limit: 5, used: 4, available: 1 });
});

test("doctor add-ons increase the overall user quota and retain the separate provider cap", () => {
  const doctorGrant = grant({ resourceType: "doctor", quantity: 2, baselineCount: 1, baselineUserCount: 4 });
  assert.equal(getCombinedResourceLimit(6, [doctorGrant], "user", now), 8);
  assert.equal(getCombinedResourceLimit(6, [doctorGrant], "doctor", now), 3);
});

test("provider aliases count as doctor seats", () => {
  assert.equal(isProviderSeat("doctor"), true);
  assert.equal(isProviderSeat("specialist"), true);
  assert.equal(isProviderSeat("nurse"), false);
});
