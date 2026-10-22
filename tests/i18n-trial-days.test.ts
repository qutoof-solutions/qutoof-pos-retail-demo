import test from "node:test";
import assert from "node:assert/strict";
import { getRemainingTrialDays } from "../lib/i18n/trial-days";

const day = 86_400_000;

test("remaining trial days rounds partial days up and clamps expired trials to zero", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(getRemainingTrialDays(now + 1, now), 1);
  assert.equal(getRemainingTrialDays(now + day, now), 1);
  assert.equal(getRemainingTrialDays(now + day + 1, now), 2);
  assert.equal(getRemainingTrialDays(now - 1, now), 0);
});

test("remaining trial days accepts dates and reports unavailable dates as null", () => {
  assert.equal(getRemainingTrialDays(new Date("2026-01-03T00:00:00.000Z"), Date.UTC(2026, 0, 1)), 2);
  assert.equal(getRemainingTrialDays(null), null);
  assert.equal(getRemainingTrialDays("not-a-date"), null);
});
