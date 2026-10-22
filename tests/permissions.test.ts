import assert from "node:assert/strict";
import { test } from "node:test";
import { isClinicalRole, isFrontDeskRole, isNursingRole, isOwnerRole, isRoleAllowedForOperation, roleMatchesAny } from "../lib/operations/permissions";

test("new tenant roles map additively to legacy operational surfaces", () => {
  assert.equal(roleMatchesAny("owner", ["business_admin"]), true);
  assert.equal(roleMatchesAny("admin", ["business_admin"]), true);
  assert.equal(roleMatchesAny("receptionist", ["reception"]), true);
  assert.equal(roleMatchesAny("doctor", ["provider"]), true);
  assert.equal(roleMatchesAny("specialist", ["provider"]), true);
  assert.equal(roleMatchesAny("storekeeper", ["business_admin", "reception", "provider"]), false);
  assert.equal(roleMatchesAny("super_admin", ["business_admin"]), false);
});

test("owner and specialist scopes are distinct helpers", () => {
  assert.equal(isOwnerRole("business_admin"), true);
  assert.equal(isOwnerRole("owner"), true);
  assert.equal(isOwnerRole("admin"), false);
  assert.equal(isFrontDeskRole("receptionist"), true);
  assert.equal(isClinicalRole("specialist"), true);
  assert.equal(isClinicalRole("receptionist"), false);
});

test("ADMIN cannot manage owner-only billing, WhatsApp credentials, or onboarding", () => {
  assert.equal(isRoleAllowedForOperation("admin", ["business_admin"], "/api/ops/reports"), true);
  assert.equal(isRoleAllowedForOperation("admin", ["business_admin"], "/api/ops/billing"), false);
  assert.equal(isRoleAllowedForOperation("admin", ["business_admin"], "/api/ops/whatsapp"), false);
  assert.equal(isRoleAllowedForOperation("admin", ["business_admin"], "/api/ops/onboarding"), false);
  assert.equal(isRoleAllowedForOperation("business_admin", ["business_admin"], "/api/ops/billing"), true);
  assert.equal(isRoleAllowedForOperation("owner", ["business_admin"], "/api/ops/billing"), true);
});

test("nurse is an assignable branch-scoped role, not a provider role", () => {
  assert.equal(roleMatchesAny("nurse", ["nurse"]), true);
  assert.equal(roleMatchesAny("nurse", ["provider"]), false);
  assert.equal(isNursingRole("nurse"), true);
  assert.equal(isClinicalRole("nurse"), false);
  assert.equal(isRoleAllowedForOperation("nurse", ["business_admin", "provider", "nurse"], "/api/ops/customers/123/files"), true);
  assert.equal(isRoleAllowedForOperation("nurse", ["business_admin", "provider"], "/api/ops/customers/123/clinical"), false);
});

test("distribution custody permissions are manager-only for mutations", () => {
  assert.equal(isRoleAllowedForOperation("business_admin", ["business_admin"], "/api/ops/distribution/reps"), true);
  assert.equal(isRoleAllowedForOperation("storekeeper", ["business_admin"], "/api/ops/distribution/reps"), false);
  assert.equal(isRoleAllowedForOperation("storekeeper", ["business_admin", "storekeeper"], "/api/ops/distribution/trips"), true);
  assert.equal(isRoleAllowedForOperation("receptionist", ["business_admin", "storekeeper"], "/api/ops/distribution/trips"), false);
});
