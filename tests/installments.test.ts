import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInstallmentPlan } from "../lib/operations/installments";

test("installment plan applies interest and administrative fee then distributes every piastre", () => {
  const plan = buildInstallmentPlan({
    baseTotalMinor: 100_000,
    downPaymentMinor: 20_000,
    interestBps: 1_000,
    adminFeeMinor: 500,
    installmentCount: 3,
    frequency: "monthly",
    firstDueAt: new Date("2026-01-31T10:00:00.000Z"),
  });

  assert.equal(plan.interestFeeMinor, 8_000);
  assert.equal(plan.totalDueMinor, 108_500);
  assert.equal(plan.financedMinor, 88_500);
  assert.deepEqual(plan.amountsMinor, [29_500, 29_500, 29_500]);
  assert.equal(plan.dueAt[1]?.toISOString(), "2026-02-28T10:00:00.000Z");
});

test("installment plan allocates rounding remainder to the first installments", () => {
  const plan = buildInstallmentPlan({
    baseTotalMinor: 10,
    downPaymentMinor: 0,
    interestBps: 0,
    adminFeeMinor: 0,
    installmentCount: 3,
    frequency: "weekly",
    firstDueAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.deepEqual(plan.amountsMinor, [4, 3, 3]);
  assert.equal(plan.amountsMinor.reduce((sum, amount) => sum + amount, 0), plan.financedMinor);
  assert.equal(plan.dueAt[2]?.toISOString(), "2026-01-15T00:00:00.000Z");
});

test("installment plan rejects an excessive down payment or installment count", () => {
  assert.throws(() => buildInstallmentPlan({ baseTotalMinor: 100, downPaymentMinor: 101, interestBps: 0, adminFeeMinor: 0, installmentCount: 1, frequency: "monthly", firstDueAt: new Date() }), /الدفعة المقدمة/);
  assert.throws(() => buildInstallmentPlan({ baseTotalMinor: 100, downPaymentMinor: 0, interestBps: 0, adminFeeMinor: 0, installmentCount: 61, frequency: "monthly", firstDueAt: new Date() }), /عدد الأقساط/);
});
