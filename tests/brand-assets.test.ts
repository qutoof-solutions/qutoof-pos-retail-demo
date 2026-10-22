import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { BRAND_ASSETS } from "../lib/brand";

const root = process.cwd();
const files = [
  "public/brand/qutoof-business-logo-light.png",
  "public/brand/qutoof-business-logo-dark.png",
  "public/brand/qutoof-business-mark-light.png",
  "public/brand/qutoof-business-mark-dark.png",
  "public/brand/qutoof-business-social-v2.png",
  "public/icons/qutoof-business-pwa-192.png",
  "public/icons/qutoof-business-pwa-512.png",
];

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(join(root, directory), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(relative);
    return relative;
  });
}

test("brand registry points to complete light, dark, social and PWA assets", () => {
  for (const file of files) assert.equal(existsSync(join(root, file)), true, file);
  assert.equal(BRAND_ASSETS.logo.light, "/brand/qutoof-business-logo-light.png");
  assert.equal(BRAND_ASSETS.logo.dark, "/brand/qutoof-business-logo-dark.png");
  assert.equal(BRAND_ASSETS.mark.light, "/brand/qutoof-business-mark-light.png");
  assert.equal(BRAND_ASSETS.mark.dark, "/brand/qutoof-business-mark-dark.png");
  assert.equal(BRAND_ASSETS.og, "/brand/qutoof-business-social-v2.png");
  assert.equal(BRAND_ASSETS.pwa.small, "/icons/qutoof-business-pwa-192.png");
  assert.equal(BRAND_ASSETS.pwa.large, "/icons/qutoof-business-pwa-512.png");
});

test("no runtime source contains the deleted legacy logo paths", () => {
  const sourceFiles = ["app", "components", "lib", "public"]
    .flatMap((directory) => collectSourceFiles(directory))
    .filter((file) => !file.endsWith("tests/brand-assets.test.ts"));
  const legacyTokens = [/qutoof-mark/i, /qutoof-logo/i, /qutoof-192\.(png|svg)/i, /qutoof-512\.(png|svg)/i];
  for (const file of sourceFiles) {
    const source = readFileSync(join(root, file), "utf8");
    for (const token of legacyTokens) assert.equal(token.test(source), false, `${file} contains ${token}`);
  }
});
