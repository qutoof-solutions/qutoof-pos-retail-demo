import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertInsuranceClaimTransition, canTransitionInsuranceClaim, INSURANCE_CLAIM_STATUSES } from "../lib/operations/medical-contracts";
import { canPerformInsuranceClaimTransition, claimCreationEventKey, claimEventPayload, claimTransitionEventKey, normalizeClaimEvent, parseClaimEventMetadata } from "../lib/operations/medical-claims";

const routeSource = readFileSync(new URL("../app/api/ops/medical/route.ts", import.meta.url), "utf8");

test("insurance claim state matrix is terminal-safe", () => {
  const expected: Record<string, string[]> = {
    open: ["submitted", "rejected"],
    submitted: ["approved", "rejected"],
    approved: ["paid", "rejected"],
    rejected: [],
    paid: [],
  };
  for (const from of INSURANCE_CLAIM_STATUSES) {
    for (const to of INSURANCE_CLAIM_STATUSES) {
      assert.equal(canTransitionInsuranceClaim(from, to), expected[from].includes(to), `${from} -> ${to}`);
      if (expected[from].includes(to)) assert.doesNotThrow(() => assertInsuranceClaimTransition(from, to));
    }
  }
});

test("claim event idempotency keys and payloads are deterministic", () => {
  assert.equal(claimCreationEventKey("invoice-request"), "insurance-claim:invoice-request:created");
  assert.equal(claimTransitionEventKey("claim-1", "transition-request"), "insurance-claim:claim-1:transition:transition-request");
  assert.deepEqual(claimEventPayload({ claimId: "claim-1", nextStatus: "rejected", expectedVersion: 2 }), { claimId: "claim-1", nextStatus: "rejected", expectedVersion: 2, rejectionReason: null });
  assert.deepEqual(parseClaimEventMetadata("not-json"), {});
  assert.deepEqual(normalizeClaimEvent({ id: "e1", claimId: "c1", version: 1, type: "created", fromStatus: null, toStatus: "open", actorId: null, actorName: null, idempotencyKey: "k", metadataJson: '{"source":"invoice_issued"}', createdAt: new Date("2026-01-01") }).metadata, { source: "invoice_issued" });
});

test("financial transitions are separated from branch-authorized submission", () => {
  assert.equal(canPerformInsuranceClaimTransition("provider", "submitted"), true);
  assert.equal(canPerformInsuranceClaimTransition("provider", "approved"), false);
  assert.equal(canPerformInsuranceClaimTransition("business_admin", "approved"), true);
  assert.equal(canPerformInsuranceClaimTransition("admin", "paid"), true);
});

test("route contract atomically guards event and audit inserts with the claim update", () => {
  assert.match(routeSource, /DB\.batch\(\[/);
  assert.match(routeSource, /INSERT INTO insurance_claim_events[\s\S]*WHERE changes\(\) = 1/);
  assert.match(routeSource, /INSERT INTO audit_logs[\s\S]*WHERE changes\(\) = 1/);
  assert.match(routeSource, /insuranceClaimEvents\.claimId/);
  assert.match(routeSource, /insuranceClaimEvents\.tenantId/);
});

test("event history route enforces linked-invoice branch scope", () => {
  assert.match(routeSource, /type === "claim_audit" \|\| type === "claim_events"/);
  assert.match(routeSource, /eq\(insuranceClaims\.tenantId, tenantId\)/);
  assert.match(routeSource, /eq\(invoices\.tenantId, tenantId\)/);
  assert.match(routeSource, /await requireBranchMembership\(access\.context, invoice\.branchId\)/);
});
