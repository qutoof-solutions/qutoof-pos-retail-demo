import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type SectorGroup = { title: string; items: string[] };

function groups(messages: typeof ar): SectorGroup[] {
  return messages.landing.hero.sectorModal.groups;
}

test("+25 opens an accessible on-page sectors dialog without navigation", () => {
  const source = readFileSync("components/landing/landing-page.tsx", "utf8");
  assert.match(source, /<button[^>]+aria-haspopup="dialog"[^>]+aria-controls="sector-explorer-dialog"/);
  assert.match(source, /onClick=\{\(\) => setSectorsOpen\(true\)\}/);
  assert.match(source, /createPortal\(dialog, document\.body\)/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.doesNotMatch(source, /href="\/solutions#industry-panel"/);
});

test("Arabic and English sector catalogs contain the same seven groups and 40+ sectors", () => {
  const arabic = groups(ar);
  const english = groups(en);
  assert.equal(arabic.length, 7);
  assert.equal(english.length, 7);
  assert.ok(arabic.reduce((total, group) => total + group.items.length, 0) >= 40);
  assert.ok(english.reduce((total, group) => total + group.items.length, 0) >= 40);
  assert.equal(arabic.reduce((total, group) => total + group.items.length, 0), 42);
  assert.equal(english.reduce((total, group) => total + group.items.length, 0), 42);
  assert.deepEqual(arabic.map((group) => group.items.length), english.map((group) => group.items.length));
  assert.deepEqual(arabic.map((group) => group.title).length, english.map((group) => group.title).length);
  for (const group of [...arabic, ...english]) {
    assert.ok(group.title.trim().length > 0);
    assert.ok(group.items.every((item) => item.trim().length > 0));
  }
});
