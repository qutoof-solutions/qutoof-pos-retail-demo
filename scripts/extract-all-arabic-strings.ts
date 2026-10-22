import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ARABIC = /[\u0600-\u06ff]/;
const roots = ["app", "components"];
const files: string[] = [];
const output = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "artifacts/all-arabic-strings.json";

async function walk(directory: string): Promise<void> {
  const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) files.push(path);
  }
}

async function main(): Promise<void> {
  const results = new Map<string, { files: Set<string>; samples: string[] }>();
  for (const root of roots) await walk(root);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const lineStarts = [0];
    for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) lineStarts.push(index + 1);
    const literalPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    for (const match of source.matchAll(literalPattern)) {
      const value = match[2].replace(/\\(['"`])/g, "$1").trim();
      if (!value || !ARABIC.test(value)) continue;
      const line = lineStarts.filter((start) => start <= (match.index ?? 0)).length;
      const key = value.replace(/\s+/g, " ");
      const item = results.get(key) ?? { files: new Set<string>(), samples: [] };
      item.files.add(relative(process.cwd(), file));
      if (item.samples.length < 3) item.samples.push(`${relative(process.cwd(), file)}:${line}`);
      results.set(key, item);
    }
  }
  const payload = [...results.entries()].sort(([a], [b]) => a.localeCompare(b, "ar")).map(([text, item]) => ({ text, files: [...item.files].sort(), samples: item.samples }));
  await mkdir(join(process.cwd(), output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), fileCount: files.length, stringCount: payload.length, strings: payload }, null, 2)}\n`);
  console.log(`i18n: extracted ${payload.length} Arabic literals from ${files.length} source files to ${output}`);
}

void main();
