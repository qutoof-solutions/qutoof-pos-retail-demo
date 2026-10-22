import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landing = readFileSync("components/landing/landing-page.tsx", "utf8");
const install = readFileSync("components/landing/pwa-install.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("hero uses a centered, stacked composition instead of the old side-by-side grid", () => {
  assert.match(landing, /className="landing-hero relative mx-auto flex[^\"]*flex-col[^\"]*items-center[^\"]*text-center/);
  assert.match(landing, /landing-hero-content relative z-10 flex w-full[^\"]*items-center/);
  assert.doesNotMatch(landing, /lg:grid-cols-\[\.9fr_1\.1fr\]/);
  assert.match(landing, /landing-hero-product relative z-10 w-full/);
});

test("hero actions and industry pills remain balanced on mobile and desktop", () => {
  assert.match(landing, /landing-hero-industries mt-6 flex w-full[^\"]*flex-wrap justify-center/);
  assert.match(landing, /landing-hero-actions mt-8 flex w-full[^\"]*flex-col items-center justify-center[^\"]*sm:flex-row/);
  assert.match(landing, /inline-flex min-h-12 w-full items-center justify-center/);
  assert.match(install, /variant === "hero" \? "w-full[^\"]*sm:w-auto sm:min-w-52/);
  assert.match(landing, /landing-hero-promises mt-8 grid w-full[^\"]*sm:grid-cols-3/);
});

test("hero polish keeps RTL and LTR content language-aware", () => {
  assert.match(landing, /lang=\{language\} dir=\{isAr \? "rtl" : "ltr"\}/);
  assert.match(landing, /const Arrow = isAr \? ArrowLeft : ArrowRight/);
  assert.match(css, /\.landing-hero-content \{ text-wrap: balance; \}/);
});
