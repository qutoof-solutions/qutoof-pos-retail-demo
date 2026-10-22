import assert from "node:assert/strict";
import test from "node:test";
import { calculateDepositMinor, DEFAULT_BOOKING_POLICY, isRescheduleAllowed, isWithinBookingChangeWindow, normalizeBookingPolicy } from "../lib/operations/booking-policy";

test("existing profiles receive the compatible default booking policy", () => {
  assert.deepEqual(normalizeBookingPolicy(null), DEFAULT_BOOKING_POLICY);
  assert.deepEqual(normalizeBookingPolicy({}), DEFAULT_BOOKING_POLICY);
});

test("booking policy normalization clamps invalid stored values to safe defaults", () => {
  assert.deepEqual(normalizeBookingPolicy({ cancellationLeadMinutes: -1, maxReschedules: 11, depositRequired: true, depositPercentBps: 10_001 }), DEFAULT_BOOKING_POLICY);
});

test("cancellation and reschedule deadline includes the exact allowed boundary", () => {
  const now = Date.UTC(2026, 9, 9, 10, 0);
  assert.equal(isWithinBookingChangeWindow(now + 120 * 60_000, now, 120), true);
  assert.equal(isWithinBookingChangeWindow(now + 120 * 60_000 - 1, now, 120), false);
  assert.equal(isWithinBookingChangeWindow(now, now, 0), true);
});

test("reschedule policy denies at the configured limit and rejects invalid counters", () => {
  assert.equal(isRescheduleAllowed(0, 3), true);
  assert.equal(isRescheduleAllowed(2, 3), true);
  assert.equal(isRescheduleAllowed(3, 3), false);
  assert.equal(isRescheduleAllowed(0, 0), false);
  assert.equal(isRescheduleAllowed(-1, 3), false);
});

test("deposit amount rounds up in minor currency units and supports full prepayment", () => {
  assert.equal(calculateDepositMinor(10_001, 2_500), 2_501);
  assert.equal(calculateDepositMinor(12_345, 10_000), 12_345);
  assert.equal(calculateDepositMinor(12_345, 0), 0);
  assert.throws(() => calculateDepositMinor(-1, 5_000), RangeError);
  assert.throws(() => calculateDepositMinor(100, 10_001), RangeError);
});
