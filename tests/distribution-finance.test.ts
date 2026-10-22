import assert from "node:assert/strict";
import test from "node:test";
import { calculateProfit, cashDifference, validateTripSettlement } from "../lib/operations/distribution-finance";

test("trip settlement requires every loaded unit to be sold, returned, damaged, or recorded missing", () => {
  assert.doesNotThrow(() => validateTripSettlement({ loadedUnits: 1_000, soldUnits: 600, returnedGoodUnits: 300, returnedDamagedUnits: 50, missingUnits: 50 }));
  assert.throws(() => validateTripSettlement({ loadedUnits: 1_000, soldUnits: 600, returnedGoodUnits: 300, returnedDamagedUnits: 0, missingUnits: 50 }), /يساوي/u);
  assert.throws(() => validateTripSettlement({ loadedUnits: 1, soldUnits: -1, returnedGoodUnits: 2, returnedDamagedUnits: 0, missingUnits: 0 }), /صحيحة/u);
});

test("profit uses invoice revenue less COGS, operating expenses, and rep commission", () => {
  assert.deepEqual(calculateProfit({ salesMinor: 100_000, cogsMinor: 52_000, operatingExpensesMinor: 8_000, commissionBps: 500 }), {
    salesMinor: 100_000,
    cogsMinor: 52_000,
    operatingExpensesMinor: 8_000,
    commissionBps: 500,
    commissionMinor: 5_000,
    grossProfitMinor: 48_000,
    netProfitMinor: 35_000,
  });
  assert.throws(() => calculateProfit({ salesMinor: -1, cogsMinor: 0, operatingExpensesMinor: 0 }), /غير سالبة/u);
});

test("cash settlement reports overage and shortage without converting currency units", () => {
  assert.equal(cashDifference(12_500, 12_000), -500);
  assert.equal(cashDifference(12_500, 13_000), 500);
  assert.throws(() => cashDifference(1.5, 2), /قروشاً/u);
});
