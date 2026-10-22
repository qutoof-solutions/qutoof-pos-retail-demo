import assert from "node:assert/strict";
import test from "node:test";
import { canUseOnboardingSetup, isTenantOnboardingComplete, readTenantOnboardingState, writeTenantOnboardingState } from "../lib/operations/onboarding";

test("existing tenants are not forced through onboarding retroactively", () => {
  assert.deepEqual(readTenantOnboardingState("{}"), { required: false, version: 0, completedAt: null });
  assert.equal(isTenantOnboardingComplete("{}"), true);
  assert.equal(isTenantOnboardingComplete("not-json"), true);
});

test("new tenant onboarding remains required until a completion timestamp exists", () => {
  const initial = JSON.stringify({ onboarding: { required: true, version: 1, completedAt: null } });
  assert.equal(readTenantOnboardingState(initial).required, true);
  assert.equal(isTenantOnboardingComplete(initial), false);
  assert.equal(canUseOnboardingSetup(initial, "business_admin", "pending_trial"), true);
  assert.equal(canUseOnboardingSetup(initial, "business_admin", "active_trial"), true);
  assert.equal(canUseOnboardingSetup(initial, "business_admin", "frozen"), false);
  assert.equal(canUseOnboardingSetup(initial, "provider", "pending_trial"), false);
  assert.equal(canUseOnboardingSetup(initial, "reception", "pending_trial"), false);
});

test("writing onboarding state preserves unrelated tenant settings", () => {
  const saved = writeTenantOnboardingState(JSON.stringify({ theme: "dark", externalConfig: { enabled: true } }), {
    required: false,
    version: 1,
    completedAt: "2026-10-09T10:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(saved), {
    theme: "dark",
    externalConfig: { enabled: true },
    onboarding: { required: false, version: 1, completedAt: "2026-10-09T10:00:00.000Z" },
  });
  assert.equal(isTenantOnboardingComplete(saved), true);
  assert.equal(canUseOnboardingSetup(saved, "business_admin", "pending_trial"), false);
});
