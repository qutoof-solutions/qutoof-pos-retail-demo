import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_STORAGE_KEY } from "../lib/i18n/locale-cookie";
import { THEME_SCRIPT } from "../components/theme/theme-script";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|js|jsx)$/.test(path) ? [path] : [];
  });
}

test("application localization does not inspect or mutate the rendered DOM", () => {
  const files = ["app", "components", "lib"].flatMap(sourceFiles);
  const forbidden = ["Mutation" + "Observer", "create" + "TreeWalker", "global-auto-translate-provider", "global-master-dictionary"];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const signature of forbidden) assert.equal(source.includes(signature), false, `${file} contains forbidden DOM localization signature: ${signature}`);
  }
});

test("locale persistence keeps localStorage and the SSR cookie aligned", () => {
  const providerSource = readFileSync("components/operations/data-portability-ui.tsx", "utf8");
  const cookieSource = readFileSync("lib/i18n/locale-cookie.ts", "utf8");
  assert.match(cookieSource, /LOCALE_COOKIE_NAME\s*=\s*"qutoof-locale"/);
  assert.equal(LOCALE_STORAGE_KEY, "qutoof-locale");
  assert.match(providerSource, /localStorage\.getItem\(LOCALE_STORAGE_KEY\)/);
  assert.match(providerSource, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/);
  assert.match(THEME_SCRIPT, /localStorage\.getItem\('qutoof-locale'\)/);
  assert.match(THEME_SCRIPT, /root\.setAttribute\('dir'/);
});
