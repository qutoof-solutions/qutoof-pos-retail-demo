import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Hex, summarizeChequeStatuses, summarizeTreasury } from "../lib/operations/z-report";

test("Z-report canonical JSON sorts object keys but preserves array order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: true, c: null }, rows: [{ z: 1, a: 2 }] }), '{"a":{"c":null,"d":true},"b":2,"rows":[{"a":2,"z":1}]}');
  assert.equal(canonicalJson({ rows: [2, 1] }), '{"rows":[2,1]}');
});

test("Z-report payload hash is deterministic and changes on a source event", async () => {
  const first = canonicalJson({ schemaVersion: 1, payments: [{ id: "p1", amountMinor: 1000 }] });
  const second = canonicalJson({ schemaVersion: 1, payments: [{ id: "p1", amountMinor: 1001 }] });
  assert.equal(await sha256Hex(first), "56028a42aed0ae46f14fd524503410015205c9f3a38951c41bca7c4e8a16202e");
  assert.notEqual(await sha256Hex(first), await sha256Hex(second));
});

test("Z-report treasury totals retain reversal events and expose signed net", () => {
  assert.deepEqual(summarizeTreasury([
    { direction: "in", amountMinor: 1000, reversalOfId: null },
    { direction: "out", amountMinor: 300, reversalOfId: null },
    { direction: "in", amountMinor: 300, reversalOfId: "out-1" },
  ]), { incomingMinor: 1300, outgoingMinor: 300, reversalIncomingMinor: 300, reversalOutgoingMinor: 0, netMinor: 1000 });
});

test("Z-report cheque totals remain split by incoming/outgoing status", () => {
  assert.deepEqual(summarizeChequeStatuses([{ status: "pending", amountMinor: 500 }, { status: "pending", amountMinor: 700 }, { status: "returned", amountMinor: 200 }]), { pending: 1200, returned: 200 });
});
