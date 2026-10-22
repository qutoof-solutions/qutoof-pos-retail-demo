import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { resolveApiErrorMessage, resolveApiLocale } from "../components/platform/api-client";

type JsonValue = JsonValue[] | { [key: string]: JsonValue } | string | number | boolean | null;

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function lookup(value: JsonValue, path: string): JsonValue {
  return path.split(".").reduce<JsonValue>((current, key) => {
    assert.ok(current && typeof current === "object" && !Array.isArray(current), `missing message path: ${path}`);
    return (current as { [key: string]: JsonValue })[key];
  }, value);
}

test("Arabic and English catalogs keep identical leaf-key coverage", () => {
  assert.deepEqual(leafPaths(ar).sort(), leafPaths(en).sort());
});

test("marketing navigation and home page CTAs are bilingual and non-empty", () => {
  const required = [
    "landing.nav.home",
    "landing.nav.solutions",
    "landing.nav.pricing",
    "landing.nav.login",
    "landing.nav.language",
    "landing.nav.openMenu",
    "landing.nav.closeMenu",
    "landing.nav.mainNavigation",
    "landing.pageCtas.solutions",
    "landing.pageCtas.pricing",
  ];
  for (const path of required) {
    const arabic = lookup(ar, path);
    const english = lookup(en, path);
    assert.equal(typeof arabic, "string", `${path} Arabic value`);
    assert.equal(typeof english, "string", `${path} English value`);
    assert.ok(String(arabic).trim().length > 0, `${path} Arabic value is empty`);
    assert.ok(String(english).trim().length > 0, `${path} English value is empty`);
    assert.notEqual(arabic, english, `${path} must have translated values`);
  }
});

test("API errors stay centralized and follow the requested active locale", () => {
  assert.equal(resolveApiLocale("ar", "qutoof-locale=en"), "ar");
  assert.equal(resolveApiLocale("en", "qutoof-locale=ar"), "en");
  assert.equal(resolveApiErrorMessage({ errorCode: "forbiddenRequest" }, 403, "ar").message, ar.platformAdmin.apiErrors.forbiddenRequest);
  assert.equal(resolveApiErrorMessage({ errorCode: "forbiddenRequest" }, 403, "en").message, en.platformAdmin.apiErrors.forbiddenRequest);
  assert.equal(resolveApiErrorMessage({ error: en.p1Server.legacyApi.invalidPlanData }, 400, "ar").message, ar.platformAdmin.apiErrors.invalidInput);
});

test("the three marketing routes are represented by source route modules", () => {
  const routes = [
    ["/", "app/page.tsx"],
    ["/solutions", "app/solutions/page.tsx"],
    ["/pricing", "app/pricing/page.tsx"],
  ] as const;
  for (const [route, sourcePath] of routes) {
    assert.equal(existsSync(sourcePath), true, `${route} must have a source route module`);
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, /\bexport\s+default\b/, `${route} source must export a page`);
  }
});

test("marketing components source copy from landing message namespaces", () => {
  const sources = [
    "components/landing/marketing-sections.tsx",
    "components/landing/industry-tabs.tsx",
    "components/landing/pricing-section.tsx",
    "components/landing/landing-page.tsx",
  ];
  for (const sourcePath of sources) {
    const source = readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /\bconst\s+(content|copy)\b/, `${sourcePath} must not define bilingual content/copy locally`);
    assert.match(source, /useTranslations/, `${sourcePath} must use next-intl translations`);
  }
  assert.match(readFileSync("components/landing/marketing-sections.tsx", "utf8"), /t\.raw\("(?:why|testimonials|faq)\./);
  assert.match(readFileSync("components/landing/industry-tabs.tsx", "utf8"), /t\.raw\("items"\)/);
  assert.match(readFileSync("components/landing/landing-page.tsx", "utf8"), /i18n\.raw\("hero\.industries"\)/);
});

test("homepage presents operational examples followed by a ten-question FAQ", () => {
  const homepage = readFileSync("components/landing/landing-page.tsx", "utf8");
  const pricing = readFileSync("components/landing/pricing-page.tsx", "utf8");
  assert.match(homepage, /TestimonialsSection language=\{language\} \/>/);
  assert.match(homepage, /FaqSection language=\{language\} \/>/);
  assert.ok(homepage.indexOf("TestimonialsSection language={language}") < homepage.indexOf("FaqSection language={language}"));
  assert.doesNotMatch(pricing, /FaqSection/);
  assert.equal((ar.landing.marketing.faq.items as string[][]).length, 10);
  assert.equal((en.landing.marketing.faq.items as string[][]).length, 10);
});

test("Z-report labels are wired to translated values before rendering", () => {
  const source = readFileSync("components/landing/landing-page.tsx", "utf8");
  for (const key of ["mockupTitle", "sampleId", "currency", "reconciliation", "illustration"]) {
    assert.match(source, new RegExp(`\\b${key}: i18n\\(\\"features\\.${key}\\"\\)`), `${key} must be mapped from the catalog`);
  }
});

test("marketing content never depends on an observer to become readable", () => {
  const source = readFileSync("components/landing/scroll-reveal.tsx", "utf8");
  assert.doesNotMatch(source, /IntersectionObserver|useState\(|opacity:\s*0/);
  assert.match(source, /scroll-reveal-visible/);
});
