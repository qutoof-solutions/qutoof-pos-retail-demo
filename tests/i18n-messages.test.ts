import test from "node:test";
import assert from "node:assert/strict";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

test("Arabic and English message catalogs have identical keys", () => {
  assert.deepEqual(leafKeys(ar).sort(), leafKeys(en).sort());
});

test("English message values contain no Arabic UI text", () => {
  const arabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
  const violations: string[] = [];
  function inspect(value: unknown, prefix = "") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "string" && arabic.test(child)) violations.push(`${path}: ${child}`);
      else inspect(child, path);
    }
  }
  inspect(en);
  assert.deepEqual(violations, []);
});
