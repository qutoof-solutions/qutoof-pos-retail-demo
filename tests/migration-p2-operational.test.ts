import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(process.cwd(), "drizzle/migrations/0045_p2_operational_contracts.sql");

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function indexInfo(db: DatabaseSync, table: string): Array<{ name: string; unique: number }> {
  return db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>;
}

function applyMigration(db: DatabaseSync): void {
  const sql = readFileSync(migrationPath, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

function createBaseSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE branches (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE users (id text PRIMARY KEY, tenant_id text REFERENCES tenants(id));
    CREATE TABLE customers (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE appointments (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE shift_settlements (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE offline_stock_conflicts (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE insurance_claims (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE invoices (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE gym_pt_sessions (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
    CREATE TABLE gym_body_measurements (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id));
  `);
}

test("0045 additive operational migration applies without rebuilding existing tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    createBaseSchema(db);
    db.prepare("INSERT INTO tenants (id) VALUES (?)").run("tenant-a");
    db.prepare("INSERT INTO tenants (id) VALUES (?)").run("tenant-b");
    applyMigration(db);

    for (const [table, required] of Object.entries({
      z_report_snapshots: ["tenant_id", "branch_id", "settlement_id", "schema_version", "generated_by", "closed_at", "idempotency_key", "payload_hash", "snapshot_json", "created_at"],
      offline_conflict_actions: ["tenant_id", "conflict_id", "idempotency_key", "payload_hash", "action", "payload_json", "result_json", "actor_id", "created_at"],
      insurance_claim_events: ["tenant_id", "claim_id", "version", "type", "from_status", "to_status", "actor_id", "idempotency_key", "payload_hash", "metadata_json", "created_at"],
      gym_pt_session_usages: ["tenant_id", "branch_id", "session_id", "customer_id", "actor_id", "appointment_id", "idempotency_key", "payload_hash", "consumed_at", "created_at"],
      invoice_adjustments: ["tenant_id", "invoice_id", "adjustment_type", "idempotency_key", "payload_hash", "total_delta_minor", "created_at"],
    })) {
      assert.deepEqual(required.every((column) => columnNames(db, table).includes(column)), true, `${table} columns`);
    }
    assert.deepEqual(columnNames(db, "gym_pt_sessions").filter((column) => ["branch_id", "idempotency_key", "payload_hash"].includes(column)).sort(), ["branch_id", "idempotency_key", "payload_hash"]);
    assert.deepEqual(columnNames(db, "gym_body_measurements").filter((column) => ["branch_id", "idempotency_key", "payload_hash"].includes(column)).sort(), ["branch_id", "idempotency_key", "payload_hash"]);

    const uniqueIndexNames = (table: string) => indexInfo(db, table).filter((index) => index.unique === 1).map((index) => index.name);
    assert.ok(uniqueIndexNames("z_report_snapshots").includes("z_report_snapshots_tenant_settlement_uq"));
    assert.ok(uniqueIndexNames("z_report_snapshots").includes("z_report_snapshots_tenant_key_uq"));
    assert.ok(uniqueIndexNames("offline_conflict_actions").includes("offline_conflict_actions_tenant_key_uq"));
    assert.ok(uniqueIndexNames("insurance_claim_events").includes("insurance_claim_events_claim_version_uq"));
    assert.ok(uniqueIndexNames("insurance_claim_events").includes("insurance_claim_events_tenant_key_uq"));
    assert.ok(uniqueIndexNames("gym_pt_session_usages").includes("gym_pt_session_usages_tenant_key_uq"));

    db.prepare("INSERT INTO shift_settlements (id, tenant_id) VALUES (?, ?)").run("settlement-a", "tenant-a");
    db.prepare("INSERT INTO z_report_snapshots (id, tenant_id, settlement_id, schema_version, closed_at, idempotency_key, payload_hash, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("report-a", "tenant-a", "settlement-a", 1, 100, "report-key", "hash", "{}", 100);
    assert.throws(() => db.prepare("INSERT INTO z_report_snapshots (id, tenant_id, settlement_id, schema_version, closed_at, idempotency_key, payload_hash, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("report-b", "tenant-a", "settlement-a", 1, 101, "report-key-2", "hash-2", "{}", 101), /UNIQUE/);
    db.prepare("INSERT INTO z_report_snapshots (id, tenant_id, settlement_id, schema_version, closed_at, idempotency_key, payload_hash, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("report-c", "tenant-b", "settlement-a", 1, 102, "report-key", "hash-3", "{}", 102);
    assert.throws(() => db.prepare("UPDATE z_report_snapshots SET snapshot_json = ? WHERE id = ?").run("{}", "report-a"), /immutable/);
    assert.throws(() => db.prepare("DELETE FROM z_report_snapshots WHERE id = ?").run("report-a"), /immutable/);

    db.prepare("INSERT INTO gym_pt_sessions (id, tenant_id) VALUES (?, ?)").run("session-a", "tenant-a");
    db.prepare("INSERT INTO customers (id, tenant_id) VALUES (?, ?)").run("customer-a", "tenant-a");
    db.prepare("INSERT INTO gym_pt_session_usages (id, tenant_id, session_id, customer_id, idempotency_key, payload_hash, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("usage-a", "tenant-a", "session-a", "customer-a", "usage-key-a", "hash", 100, 100);
    db.prepare("INSERT INTO gym_pt_session_usages (id, tenant_id, session_id, customer_id, idempotency_key, payload_hash, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("usage-b", "tenant-a", "session-a", "customer-a", "usage-key-b", "hash-2", 101, 101);
    assert.throws(() => db.prepare("INSERT INTO gym_pt_session_usages (id, tenant_id, session_id, customer_id, idempotency_key, payload_hash, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("usage-c", "tenant-a", "session-a", "customer-a", "usage-key-a", "hash-3", 102, 102), /UNIQUE/);
  } finally {
    db.close();
  }
});
