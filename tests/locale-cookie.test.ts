import test from "node:test";
import assert from "node:assert/strict";
import { createLocaleCookie, DEFAULT_LOCALE, LOCALE_COOKIE_NAME, localeDirection, readAppLocaleCookie, resolveAppLocale, resolveAppLocaleSafely } from "../lib/i18n/locale-cookie";

test("locale cookie is the sole source value and defaults safely to Arabic", () => {
  assert.equal(resolveAppLocale("en"), "en");
  assert.equal(resolveAppLocale("ar"), "ar");
  assert.equal(resolveAppLocale(undefined), DEFAULT_LOCALE);
  assert.equal(resolveAppLocale(null), DEFAULT_LOCALE);
  assert.equal(resolveAppLocale("fr"), DEFAULT_LOCALE);
});

test("locale cookie serialization scopes a persistent same-site cookie to the whole app", () => {
  assert.equal(createLocaleCookie("en"), `${LOCALE_COOKIE_NAME}=en; Path=/; Max-Age=31536000; SameSite=Lax`);
  assert.equal(createLocaleCookie("ar", true), `${LOCALE_COOKIE_NAME}=ar; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
});

test("locale direction follows the selected locale", () => {
  assert.equal(localeDirection("ar"), "rtl");
  assert.equal(localeDirection("en"), "ltr");
});

test("cookie reader finds only the exact locale cookie among unrelated cookies", () => {
  assert.equal(readAppLocaleCookie("session=abc; qutoof-locale=en; theme=dark"), "en");
  assert.equal(readAppLocaleCookie("other-qutoof-locale=en; qutoof-locale=ar"), "ar");
  assert.equal(readAppLocaleCookie("session=abc"), "ar");
});

test("server locale resolver falls back safely when cookie access fails", async () => {
  assert.equal(await resolveAppLocaleSafely(async () => "en"), "en");
  assert.equal(await resolveAppLocaleSafely(async () => { throw new Error("cookie API unavailable"); }), DEFAULT_LOCALE);
});
