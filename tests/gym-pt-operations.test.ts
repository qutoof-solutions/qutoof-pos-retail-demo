import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE customer_memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, branch_id TEXT NOT NULL, status TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL);
    CREATE TABLE gym_pt_sessions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT, customer_id TEXT NOT NULL, membership_id TEXT, total_sessions INTEGER NOT NULL, used_sessions INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE TABLE gym_pt_session_usages (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT, session_id TEXT NOT NULL, customer_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, consumed_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE (tenant_id, idempotency_key));
  `);
}

type ConsumeInput = { tenantId: string; customerId: string; sessionId: string; branchId: string; key: string; hash: string; now: number; accessibleBranches: string[] };
function consume(db: DatabaseSync, input: ConsumeInput): "consumed" | "replayed" | "rejected" {
  const existing = db.prepare("SELECT session_id, customer_id, payload_hash FROM gym_pt_session_usages WHERE tenant_id = ? AND idempotency_key = ?").get(input.tenantId, input.key) as { session_id: string; customer_id: string; payload_hash: string } | undefined;
  if (existing) {
    if (existing.session_id !== input.sessionId || existing.customer_id !== input.customerId || existing.payload_hash !== input.hash) return "rejected";
    return "replayed";
  }
  if (!input.accessibleBranches.includes(input.branchId)) return "rejected";
  const session = db.prepare("SELECT membership_id, total_sessions, used_sessions FROM gym_pt_sessions WHERE id = ? AND tenant_id = ? AND customer_id = ? AND branch_id = ?").get(input.sessionId, input.tenantId, input.customerId, input.branchId) as { membership_id: string | null; total_sessions: number; used_sessions: number } | undefined;
  if (!session || session.used_sessions >= session.total_sessions) return "rejected";
  if (session.membership_id) {
    const membership = db.prepare("SELECT status, starts_at, ends_at, branch_id FROM customer_memberships WHERE id = ? AND tenant_id = ? AND customer_id = ?").get(session.membership_id, input.tenantId, input.customerId) as { status: string; starts_at: number; ends_at: number; branch_id: string } | undefined;
    if (!membership || membership.branch_id !== input.branchId || membership.status !== "active" || membership.starts_at > input.now || membership.ends_at <= input.now) return "rejected";
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db.prepare("UPDATE gym_pt_sessions SET used_sessions = used_sessions + 1, updated_at = ? WHERE id = ? AND tenant_id = ? AND customer_id = ? AND branch_id = ? AND used_sessions < total_sessions").run(input.now, input.sessionId, input.tenantId, input.customerId, input.branchId);
    if (Number(updated.changes) !== 1) { db.exec("ROLLBACK"); return "rejected"; }
    db.prepare("INSERT INTO gym_pt_session_usages (id, tenant_id, branch_id, session_id, customer_id, idempotency_key, payload_hash, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(`${input.key}:usage`, input.tenantId, input.branchId, input.sessionId, input.customerId, input.key, input.hash, input.now, input.now);
    db.exec("COMMIT");
    return "consumed";
  } catch (error) {
    db.exec("ROLLBACK");
    if (error instanceof Error && error.message.includes("UNIQUE")) return "replayed";
    throw error;
  }
}

function close(db: DatabaseSync): void { db.close(); }

test("PT consume replay is idempotent and appends one ledger row", () => {
  const db = new DatabaseSync(":memory:");
  try {
    schema(db);
    db.prepare("INSERT INTO gym_pt_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("s1", "t1", "b1", "c1", null, 2, 0, 0);
    const input = { tenantId: "t1", customerId: "c1", sessionId: "s1", branchId: "b1", key: "consume-1", hash: "hash-1", now: 100, accessibleBranches: ["b1"] } satisfies ConsumeInput;
    assert.equal(consume(db, input), "consumed");
    assert.equal(consume(db, input), "replayed");
    assert.equal((db.prepare("SELECT used_sessions FROM gym_pt_sessions WHERE id = ?").get("s1") as { used_sessions: number }).used_sessions, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM gym_pt_session_usages WHERE session_id = ?").get("s1") as { count: number }).count, 1);
  } finally { close(db); }
});

test("PT consume rejects the second concurrent-style attempt when balance is exhausted", () => {
  const db = new DatabaseSync(":memory:");
  try {
    schema(db);
    db.prepare("INSERT INTO gym_pt_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("s1", "t1", "b1", "c1", null, 1, 0, 0);
    const base = { tenantId: "t1", customerId: "c1", sessionId: "s1", branchId: "b1", hash: "hash", now: 100, accessibleBranches: ["b1"] };
    assert.equal(consume(db, { ...base, key: "consume-a" }), "consumed");
    assert.equal(consume(db, { ...base, key: "consume-b" }), "rejected");
    assert.equal((db.prepare("SELECT used_sessions FROM gym_pt_sessions WHERE id = ?").get("s1") as { used_sessions: number }).used_sessions, 1);
  } finally { close(db); }
});

test("PT consume enforces branch and tenant scope", () => {
  const db = new DatabaseSync(":memory:");
  try {
    schema(db);
    db.prepare("INSERT INTO gym_pt_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("s1", "tenant-a", "branch-a", "customer-a", null, 2, 0, 0);
    const input = { tenantId: "tenant-a", customerId: "customer-a", sessionId: "s1", branchId: "branch-a", key: "scope-key", hash: "hash", now: 100, accessibleBranches: ["branch-b"] } satisfies ConsumeInput;
    assert.equal(consume(db, input), "rejected");
    assert.equal(consume(db, { ...input, tenantId: "tenant-b", accessibleBranches: ["branch-a"] }), "rejected");
    assert.equal((db.prepare("SELECT used_sessions FROM gym_pt_sessions WHERE id = ?").get("s1") as { used_sessions: number }).used_sessions, 0);
  } finally { close(db); }
});

test("PT consume checks membership validity separately from remaining balance", () => {
  const db = new DatabaseSync(":memory:");
  try {
    schema(db);
    db.prepare("INSERT INTO customer_memberships VALUES (?, ?, ?, ?, ?, ?, ?)").run("m1", "t1", "c1", "b1", "active", 0, 50);
    db.prepare("INSERT INTO gym_pt_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("s1", "t1", "b1", "c1", "m1", 3, 0, 0);
    const input = { tenantId: "t1", customerId: "c1", sessionId: "s1", branchId: "b1", key: "expired-key", hash: "hash", now: 100, accessibleBranches: ["b1"] } satisfies ConsumeInput;
    assert.equal(consume(db, input), "rejected");
    assert.equal((db.prepare("SELECT used_sessions FROM gym_pt_sessions WHERE id = ?").get("s1") as { used_sessions: number }).used_sessions, 0);
  } finally { close(db); }
});
