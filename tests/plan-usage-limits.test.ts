import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getCombinedResourceLimit, type ResourceAddonGrant } from "../lib/platform/addon-entitlements";

const now = new Date("2026-10-21T12:00:00.000Z");
const grant: ResourceAddonGrant = { resourceType: "branch", quantity: 2, baselineCount: 3, baselineUserCount: 0, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z") };

test("plan limits are independent integer columns, not marketing-name lookups", () => {
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/migrations/0047_add_plan_usage_limits.sql", "utf8");
  assert.match(schema, /maxUsers: integer\("max_users"\)/);
  assert.match(schema, /maxBranches: integer\("max_branches"\)/);
  assert.match(schema, /maxWarehouses: integer\("max_warehouses"\)/);
  assert.match(migration, /NULL means unlimited/);
  assert.match(migration, /erp_starter%/);
  assert.match(migration, /clinic_center%/);
  assert.doesNotMatch(readFileSync("lib/platform/marketing-plan-limits.ts", "utf8"), /erp_starter|clinic_center/);
});

test("the effective branch cap equals the base quota plus active add-on quantity", () => {
  assert.equal(getCombinedResourceLimit(3, [grant], "branch", now), 5);
  assert.equal(getCombinedResourceLimit(4, [grant], "branch", now), 6);
  assert.equal(getCombinedResourceLimit(null, [grant], "branch", now), null);
});

test("Super Admin limit inputs are separate from plan feature JSON", () => {
  const admin = readFileSync("components/platform/plans-panel.tsx", "utf8");
  const api = readFileSync("app/api/super-admin/plans/route.ts", "utf8");
  assert.match(admin, /maxUsers: "plans\.maxUsers"/);
  assert.match(admin, /maxBranches: "plans\.maxBranches"/);
  assert.match(admin, /maxWarehouses: "plans\.maxWarehouses"/);
  assert.match(api, /maxUsers: z\.number\(\)/);
  assert.match(api, /featuresJson: JSON\.stringify\(parsed\.data\.features\)/);
});

test("plan names are unique within a billing cycle, not across the whole catalog", () => {
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/migrations/0048_plan_name_per_billing_cycle.sql", "utf8");
  assert.match(schema, /platform_plans_name_en_cycle_uq.*table\.nameEn, table\.billingCycle/);
  assert.match(migration, /DROP INDEX `platform_plans_name_en_uq`/);
  assert.match(migration, /CREATE UNIQUE INDEX `platform_plans_name_en_cycle_uq`.*`name_en`,`billing_cycle`/s);
  assert.doesNotMatch(schema, /platform_plans_name_en_uq/);
});
