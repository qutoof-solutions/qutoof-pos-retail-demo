import assert from "node:assert/strict";
import test from "node:test";
import { activityCodeFromCarrier, activityCodeFromPlanCode, resolvePlanFeatureContract, resolveActivityCode } from "../lib/platform/activity-contract";
import { THEME_SCRIPT } from "../components/theme/theme-script";

test("activityCode is canonical while legacy vertical remains a compatible fallback", () => {
  assert.equal(activityCodeFromCarrier({ activityCode: "medical", vertical: "retail" }), "medical");
  assert.equal(activityCodeFromCarrier({ vertical: "sports" }), "sports");
  assert.equal(activityCodeFromCarrier({ activityCode: "unknown", vertical: "unknown" }), "retail");
  assert.equal(resolveActivityCode(null, "beauty"), "beauty");
  assert.equal(activityCodeFromPlanCode("clinic_center_monthly"), "medical");
  assert.equal(activityCodeFromPlanCode("unknown_monthly"), "retail");
});

test("plan/features contract keeps boolean entitlements and safe fallback activity", () => {
  assert.deepEqual(resolvePlanFeatureContract({ featuresJson: '{"pos":true,"activityCode":"medical","bad":"x"}', activityCode: "medical" }), {
    activityCode: "medical",
    features: { pos: true },
  });
  assert.deepEqual(resolvePlanFeatureContract({ featuresJson: "broken", vertical: "sports", fallbackFeatures: { reports: true } }), {
    activityCode: "sports",
    features: { reports: true },
  });
});

test("pre-paint theme script contains storage, system preference, and color-scheme handling", () => {
  assert.match(THEME_SCRIPT, /localStorage\.getItem\('qutoof-theme'\)/);
  assert.match(THEME_SCRIPT, /prefers-color-scheme: dark/);
  assert.match(THEME_SCRIPT, /classList\.toggle\('dark'/);
  assert.match(THEME_SCRIPT, /style\.colorScheme/);
});

test("pre-paint theme script sets locale, direction, data-theme, and background", () => {
  assert.match(THEME_SCRIPT, /(?:document\.documentElement|root)\.setAttribute\(\s*['"]lang['"]/);
  assert.match(THEME_SCRIPT, /(?:document\.documentElement|root)\.setAttribute\(\s*['"]dir['"]/);
  assert.match(THEME_SCRIPT, /(?:dataset\.theme\s*=|(?:document\.documentElement|root)\.setAttribute\(\s*['"]data-theme['"])/);
  assert.match(THEME_SCRIPT, /(?:document\.documentElement|root)\.style\.(?:background|backgroundColor)\s*=/);
});
