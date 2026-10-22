import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const arabic = /[\u0600-\u06ff]/;
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "origin/main";
const strict = process.argv.includes("--strict");
const localizedFiles = new Set([
  "components/landing/landing-page.tsx",
  "components/landing/industry-tabs.tsx",
  "components/landing/marketing-sections.tsx",
  "components/landing/product-mockups.tsx",
  "components/landing/pwa-install.tsx",
  "components/landing/whatsapp-widget.tsx",
]);

const diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`, "--", "app", "components"], { encoding: "utf8" });
const violations: string[] = [];
let file = "";
let lineNumber = 0;
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) { file = line.slice(6); continue; }
  const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (header) { lineNumber = Number(header[1]) - 1; continue; }
  if (!line.startsWith("+" ) || line.startsWith("+++")) continue;
  lineNumber += 1;
  const source = line.slice(1);
  if (!arabic.test(source) || localizedFiles.has(file)) continue;
  violations.push(`${file}:${lineNumber}: Arabic UI text was added outside a localized source file`);
}

if (violations.length) {
  console.error(violations.join("\n"));
  if (strict) process.exit(1);
}

const trackedFiles = execFileSync("git", ["ls-files", "app", "components"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const arabicFileCount = trackedFiles.filter((path) => arabic.test(readFileSync(path, "utf8"))).length;
console.log(`i18n guard: ${arabicFileCount} source files contain Arabic; ${violations.length} new violations`);
