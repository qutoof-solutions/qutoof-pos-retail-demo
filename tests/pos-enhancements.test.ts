import assert from "node:assert/strict";
import test from "node:test";
import { extendMembershipEndAt } from "../lib/operations/membership-freeze";
import { getTierPriceMinor } from "../lib/operations/pos-pricing";

test("POS resolves each configured price tier without accepting client-side overrides", () => {
  const product = { sellingPriceMinor: 2500, wholesalePriceMinor: 2100, distributorPriceMinor: 1900 };
  assert.equal(getTierPriceMinor(product, "retail"), 2500);
  assert.equal(getTierPriceMinor(product, "wholesale"), 2100);
  assert.equal(getTierPriceMinor(product, "distributor"), 1900);
  assert.equal(getTierPriceMinor(undefined, "retail"), 0);
});

test("gym freeze extends membership end by exact whole days", () => {
  const endAt = new Date("2026-10-10T12:34:56.000Z");
  assert.equal(extendMembershipEndAt(endAt, 1).toISOString(), "2026-10-11T12:34:56.000Z");
  assert.equal(extendMembershipEndAt(endAt, 30).toISOString(), "2026-11-09T12:34:56.000Z");
  assert.equal(endAt.toISOString(), "2026-10-10T12:34:56.000Z", "the saved date object must not be mutated");
});

test("gym freeze only accepts an integer duration between one and 365 days", () => {
  for (const days of [0, -1, 1.5, 366, Number.NaN]) {
    assert.throws(() => extendMembershipEndAt(new Date(), days), RangeError);
  }
});
