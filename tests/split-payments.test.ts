import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePayments } from "../lib/operations/payment-summary";

test("split payments aggregate each method and close only at the invoice total", () => {
  const summary = summarizePayments([
    { amountMinor: 12_500, paymentMethod: "cash" },
    { amountMinor: 7_500, paymentMethod: "card" },
  ], 20_000);

  assert.equal(summary.totalMinor, 20_000);
  assert.deepEqual(summary.byMethod, { cash: 12_500, card: 7_500, wallet: 0, instapay: 0 });
  assert.equal(summary.remainingMinor, 0);
  assert.equal(summary.isFullyPaid, true);
});

test("partial split payments leave the invoice open with an exact remainder", () => {
  const summary = summarizePayments([
    { amountMinor: 1_000, paymentMethod: "cash" },
    { amountMinor: 2_500, paymentMethod: "wallet" },
  ], 5_000);

  assert.equal(summary.totalMinor, 3_500);
  assert.equal(summary.remainingMinor, 1_500);
  assert.equal(summary.overpaymentMinor, 0);
  assert.equal(summary.isFullyPaid, false);
});

test("overpayment is reported so the API can reject it before issuing the invoice", () => {
  const summary = summarizePayments([{ amountMinor: 10_001, paymentMethod: "instapay" }], 10_000);

  assert.equal(summary.overpaymentMinor, 1);
  assert.equal(summary.isFullyPaid, true);
});
