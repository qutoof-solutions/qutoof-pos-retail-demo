import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedVersion, assertInsuranceClaimTransition, canConsumePt, canTransitionInsuranceClaim, isMembershipValid } from "../lib/operations/medical-contracts";

test("insurance claims follow a terminal-safe state machine", () => {
  assert.equal(canTransitionInsuranceClaim("open", "submitted"), true);
  assert.equal(canTransitionInsuranceClaim("submitted", "approved"), true);
  assert.equal(canTransitionInsuranceClaim("approved", "paid"), true);
  assert.equal(canTransitionInsuranceClaim("paid", "open"), false);
  assert.throws(() => assertInsuranceClaimTransition("paid", "open"), /INSURANCE_CLAIM_TRANSITION_NOT_ALLOWED/);
});

test("clinical writes reject stale versions", () => {
  assert.doesNotThrow(() => assertExpectedVersion(3, 3));
  assert.throws(() => assertExpectedVersion(3, 2), /VERSION_CONFLICT/);
});

test("membership validity is independent from remaining PT entitlement", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(isMembershipValid({ status: "active", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-02-01") }, now), true);
  assert.equal(isMembershipValid({ status: "active", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-15") }, now), false);
  assert.equal(canConsumePt({ membershipValid: true, usedSessions: 2, totalSessions: 3 }), true);
  assert.equal(canConsumePt({ membershipValid: true, usedSessions: 3, totalSessions: 3 }), false);
  assert.equal(canConsumePt({ membershipValid: false, usedSessions: 0, totalSessions: 3 }), false);
});
