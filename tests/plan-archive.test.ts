import assert from "node:assert/strict";
import test from "node:test";
import { filterPlansForArchiveView } from "../lib/platform/plan-archive";

const plans = [
  { id: "active-plan", isActive: true },
  { id: "archived-plan", isActive: false },
  { id: "active-addon", isActive: true },
];

test("active view omits archived catalog entries", () => {
  assert.deepEqual(filterPlansForArchiveView(plans, "active").map((plan) => plan.id), ["active-plan", "active-addon"]);
});

test("archive view preserves inactive entries for later restoration", () => {
  assert.deepEqual(filterPlansForArchiveView(plans, "archived").map((plan) => plan.id), ["archived-plan"]);
});
