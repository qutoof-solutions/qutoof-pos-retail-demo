import assert from "node:assert/strict";
import test from "node:test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { featureFlagCopy } from "../components/platform/feature-flag-labels";
import { resolveApiErrorMessage, resolveApiLocale } from "../components/platform/api-client";

function lookup(root: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
  assert.equal(typeof value, "string", `missing message: ${path}`);
  return value as string;
}

test("registration copy resolves in both locales and is not the old inline Arabic copy", () => {
  assert.equal(lookup(ar, "register.title"), "ابدأ مساحة عملك");
  assert.equal(lookup(en, "register.title"), "Start your workspace");
  assert.notEqual(lookup(ar, "register.description"), lookup(en, "register.description"));
  assert.notEqual(lookup(ar, "register.asideText"), lookup(en, "register.asideText"));
});

test("cheque headings and every status resolve in Arabic and English", () => {
  const paths = [
    "operationsRemaining.cheques.module.title",
    "operationsRemaining.cheques.received.heading",
    "operationsRemaining.cheques.issued.heading",
    "operationsRemaining.cheques.status.pending",
    "operationsRemaining.cheques.status.collected",
    "operationsRemaining.cheques.status.cashed",
    "operationsRemaining.cheques.status.returned",
    "operationsRemaining.cheques.status.rejected",
  ];
  for (const path of paths) {
    const arabic = lookup(ar, path);
    const english = lookup(en, path);
    assert.notEqual(arabic, english, path);
    assert.ok(arabic.length > 0 && english.length > 0, path);
  }
});

test("feature flag mapping uses stable keys and has an unknown fallback", () => {
  assert.deepEqual(featureFlagCopy("maintenance_mode"), {
    label: "features.flags.maintenanceMode.label",
    description: "features.flags.maintenanceMode.description",
  });
  assert.deepEqual(featureFlagCopy("subscription_billing"), {
    label: "features.flags.subscriptionBilling.label",
    description: "features.flags.subscriptionBilling.description",
  });
  assert.deepEqual(featureFlagCopy("future_flag"), {
    label: "features.flags.unknown.label",
    description: "features.flags.unknown.description",
  });
  assert.equal(lookup(en, "platformAdmin.features.flags.unknown.label"), "Unknown feature");
});

test("API errors prefer codes, map legacy Arabic messages, and keep raw details separately", () => {
  assert.equal(resolveApiErrorMessage({ errorCode: "forbiddenRequest" }, 403, "en").message, "This request is not allowed from this origin.");
  assert.equal(resolveApiErrorMessage({ error: "الطلب غير مسموح من هذا النطاق" }, 403, "en").message, "This request is not allowed from this origin.");
  assert.equal(resolveApiErrorMessage({ errorCode: "invalidInput" }, 400, "ar").message, "البيانات المُرسلة غير صالحة.");
  const unknown = resolveApiErrorMessage({ error: "تفاصيل تحقق غير معروفة", details: { field: "amount" } }, 422, "en");
  assert.equal(unknown.message, "Could not complete the request (HTTP 422).");
  assert.deepEqual(unknown.details, { field: "amount" });
});

test("API locale follows the rendered interface before a stale cookie", () => {
  assert.equal(resolveApiLocale("en", "qutoof-locale=ar"), "en");
  assert.equal(resolveApiLocale("ar", "qutoof-locale=en"), "ar");
  assert.equal(resolveApiLocale(undefined, "other=1; qutoof-locale=ar"), "ar");
  assert.equal(resolveApiLocale(undefined, "qutoof-locale=arabic"), "en");
});

test("Arabic and English platform additions keep message-key parity", () => {
  const keys = (value: unknown, prefix = ""): string[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
    return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
  };
  assert.deepEqual(keys(ar).sort(), keys(en).sort());
});
