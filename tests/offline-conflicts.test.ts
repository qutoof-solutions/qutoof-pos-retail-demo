import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { resolveOfflineConflict, type OfflineConflictResolutionInput } from "../lib/operations/offline-conflicts";

type Statement = { sql: string; values: unknown[]; bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }> };
class D1TestDb {
  private readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE inventory_items (id TEXT PRIMARY KEY, tenant_id TEXT, sku TEXT, name TEXT, unit_code TEXT, quantity_scale INTEGER, tracks_batches INTEGER, tracks_expiry INTEGER, default_cost_minor INTEGER, is_active INTEGER);
      CREATE TABLE inventory_warehouses (id TEXT PRIMARY KEY, tenant_id TEXT, branch_id TEXT, is_active INTEGER);
      CREATE TABLE inventory_balances (id TEXT PRIMARY KEY, tenant_id TEXT, item_id TEXT, warehouse_id TEXT, batch_id TEXT, batch_key TEXT, quantity_on_hand INTEGER, updated_at INTEGER, UNIQUE(tenant_id,item_id,warehouse_id,batch_key));
      CREATE TABLE stock_operations (id TEXT PRIMARY KEY, tenant_id TEXT, operation_type TEXT, idempotency_key TEXT UNIQUE, reference_type TEXT, reference_id TEXT, created_by TEXT, notes TEXT, metadata_json TEXT, created_at INTEGER);
      CREATE TABLE stock_movements (id TEXT PRIMARY KEY, tenant_id TEXT, operation_id TEXT, item_id TEXT, warehouse_id TEXT, batch_id TEXT, movement_type TEXT, quantity_delta INTEGER, unit_cost_minor INTEGER, reference_type TEXT, reference_id TEXT, note TEXT, created_by TEXT, created_at INTEGER);
      CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT, branch_id TEXT, status TEXT, subtotal_minor INTEGER, discount_minor INTEGER, installment_fee_minor INTEGER, total_minor INTEGER, paid_minor INTEGER, payment_method TEXT, paid_at INTEGER, updated_at INTEGER);
      CREATE TABLE invoice_payments (id TEXT PRIMARY KEY, tenant_id TEXT, invoice_id TEXT, amount_minor INTEGER, payment_method TEXT, reversed_at INTEGER, reversed_by TEXT, reversal_reason TEXT, created_at INTEGER);
      CREATE TABLE shift_settlements (id TEXT PRIMARY KEY, tenant_id TEXT, branch_id TEXT, status TEXT, opened_at INTEGER, closed_at INTEGER);
      CREATE TABLE shift_settlement_adjustments (id TEXT PRIMARY KEY, tenant_id TEXT, settlement_id TEXT, payment_method TEXT, amount_delta_minor INTEGER, reason TEXT, created_by TEXT, created_at INTEGER);
      CREATE TABLE invoice_items (id TEXT PRIMARY KEY, tenant_id TEXT, invoice_id TEXT, quantity INTEGER, quantity_scale INTEGER, unit_price_minor INTEGER, unit_conversion_factor INTEGER, line_total_minor INTEGER, inventory_item_id TEXT, stock_warehouse_id TEXT);
      CREATE TABLE invoice_adjustments (id TEXT PRIMARY KEY, tenant_id TEXT, invoice_id TEXT, branch_id TEXT, adjustment_type TEXT, idempotency_key TEXT UNIQUE, payload_hash TEXT, subtotal_delta_minor INTEGER, discount_delta_minor INTEGER, total_delta_minor INTEGER, reason TEXT, metadata_json TEXT, adjusted_by TEXT, created_at INTEGER);
      CREATE TABLE installment_contracts (id TEXT PRIMARY KEY, tenant_id TEXT, invoice_id TEXT, status TEXT, updated_at INTEGER);
      CREATE TABLE installment_schedules (id TEXT PRIMARY KEY, tenant_id TEXT, invoice_id TEXT, status TEXT, paid_minor INTEGER, paid_at INTEGER, paid_by TEXT, payment_method TEXT, reference TEXT, updated_at INTEGER);
      CREATE TABLE offline_stock_conflicts (id TEXT PRIMARY KEY, tenant_id TEXT, branch_id TEXT, invoice_id TEXT, item_id TEXT, warehouse_id TEXT, requested_quantity INTEGER, available_quantity INTEGER, shortage_quantity INTEGER, quantity_scale INTEGER, resolution TEXT, replacement_quantity INTEGER, replacement_warehouse_id TEXT, resolution_note TEXT, resolved_at INTEGER, resolved_by TEXT, acknowledged_at INTEGER, acknowledged_by TEXT, created_at INTEGER);
      CREATE TABLE offline_conflict_actions (id TEXT PRIMARY KEY, tenant_id TEXT, conflict_id TEXT, idempotency_key TEXT UNIQUE, payload_hash TEXT, action TEXT, payload_json TEXT, result_json TEXT, actor_id TEXT, created_at INTEGER);
    `);
  }
  prepare(sql: string): D1PreparedStatement {
    const bindings = (values: unknown[]): SQLInputValue[] => values.map((value) => value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array ? value : String(value));
    const sqlite = this.sqlite;
    const statement: Statement = { sql, values: [], bind(...values) { statement.values = values; return statement; }, async first<T>() { const row = sqlite.prepare(sql).get(...bindings(statement.values)); return (row ? { ...row } : null) as T | null; }, async all<T>() { return { results: sqlite.prepare(sql).all(...bindings(statement.values)).map((row: Record<string, unknown>) => ({ ...row })) as T[] }; } };
    return statement as unknown as D1PreparedStatement;
  }
  async batch(statements: readonly D1PreparedStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.sqlite.exec("BEGIN");
    try {
      const bindings = (values: unknown[]): SQLInputValue[] => values.map((value) => value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array ? value : String(value));
      const results = statements.map((raw) => { const statement = raw as unknown as Statement; const result = this.sqlite.prepare(statement.sql).run(...bindings(statement.values)); return { meta: { changes: Number(result.changes) } }; });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  run(sql: string, ...values: unknown[]) { this.sqlite.prepare(sql).run(...values as SQLInputValue[]); }
  get<T>(sql: string, ...values: unknown[]) { return this.sqlite.prepare(sql).get(...values as SQLInputValue[]) as T | undefined; }
}

function seed(options: { paid?: number; balance?: number; requested?: number; fulfilled?: number } = {}): D1TestDb {
  const db = new D1TestDb();
  const requested = options.requested ?? 5;
  db.run("INSERT INTO inventory_items VALUES ('item','tenant','SKU','Widget','unit',0,0,0,100,1)");
  db.run("INSERT INTO inventory_warehouses VALUES ('warehouse','tenant','branch',1)");
  db.run("INSERT INTO inventory_balances VALUES ('balance','tenant','item','warehouse',NULL,'',?,?)", options.balance ?? 0, 1);
  db.run("INSERT INTO invoices VALUES ('invoice','tenant','branch','issued',500,0,0,500,?,?,NULL,1)", options.paid ?? 0, options.paid ? "cash" : "unpaid");
  if ((options.paid ?? 0) > 0) {
    db.run("INSERT INTO invoice_payments VALUES ('payment','tenant','invoice',?,'cash',NULL,NULL,NULL,50)", options.paid);
    db.run("INSERT INTO shift_settlements VALUES ('settlement','tenant','branch','closed',1,100)");
  }
  db.run("INSERT INTO invoice_items VALUES ('line','tenant','invoice',?,?,?,?,?,?,?)", requested, 0, 100, 1, requested * 100, "item", "warehouse");
  if ((options.fulfilled ?? 0) > 0) {
    db.run("INSERT INTO stock_operations VALUES ('initial-op','tenant','point_of_sale','initial-key','invoice','invoice','user','', '{}',1)");
    db.run("INSERT INTO stock_movements VALUES ('initial-movement','tenant','initial-op','item','warehouse',NULL,'pos_deduction',-?,100,'invoice','invoice','offline sale','user',1)", options.fulfilled);
  }
  db.run("INSERT INTO offline_stock_conflicts (id,tenant_id,branch_id,invoice_id,item_id,warehouse_id,requested_quantity,available_quantity,shortage_quantity,quantity_scale,resolution,created_at) VALUES ('conflict','tenant','branch','invoice','item','warehouse',?,?,? ,0,'pending',1)", requested, options.balance ?? 0, Math.max(0, requested - (options.balance ?? 0)));
  return db;
}
function input(db: D1TestDb, action: OfflineConflictResolutionInput["action"], key: string, extra: Partial<OfflineConflictResolutionInput> = {}): OfflineConflictResolutionInput {
  return { tenantId: "tenant", actorId: "user", conflictId: "conflict", action, idempotencyKey: key, payloadHash: `${key}-hash`, payloadJson: JSON.stringify({ action, key }), ...extra };
}

test("retry creates a real stock movement, is replayable, and rejects a second resolution", async () => {
  const db = seed({ balance: 3, fulfilled: 3 });
  const result = await resolveOfflineConflict(db as unknown as D1Database, input(db, "retry", "retry-key", { replacementQuantity: 2 }));
  assert.equal(result.replayed, false);
  assert.equal(db.get<{ quantity_on_hand: number }>("SELECT quantity_on_hand FROM inventory_balances")?.quantity_on_hand, 1);
  assert.equal(db.get<{ count: number }>("SELECT COUNT(*) count FROM stock_movements WHERE movement_type='pos_deduction'")?.count, 2);
  const replay = await resolveOfflineConflict(db as unknown as D1Database, input(db, "retry", "retry-key", { replacementQuantity: 2 }));
  assert.equal(replay.replayed, true);
  await assert.rejects(resolveOfflineConflict(db as unknown as D1Database, input(db, "retry", "other-key", { replacementQuantity: 0 })), /تم تسجيل قرار/);
});

test("reallocate draws the remaining shortage from the selected warehouse and records it", async () => {
  const db = seed({ balance: 0 });
  db.run("INSERT INTO inventory_warehouses VALUES ('shared','tenant',NULL,1)");
  db.run("INSERT INTO inventory_balances VALUES ('shared-balance','tenant','item','shared',NULL,'',5,1)");
  const result = await resolveOfflineConflict(db as unknown as D1Database, input(db, "reallocate", "reallocate-key", { replacementQuantity: 5, replacementWarehouseId: "shared" }));
  assert.equal(result.result.targetQuantity, 5);
  assert.equal(db.get<{ quantity_on_hand: number }>("SELECT quantity_on_hand FROM inventory_balances WHERE warehouse_id='shared'")?.quantity_on_hand, 0);
  assert.equal(db.get<{ warehouse_id: string }>("SELECT warehouse_id FROM stock_movements")?.warehouse_id, "shared");
});

test("edit changes the invoice line and writes an auditable adjustment atomically", async () => {
  const db = seed({ balance: 3 });
  const result = await resolveOfflineConflict(db as unknown as D1Database, input(db, "edit", "edit-key", { replacementQuantity: 3 }));
  assert.equal(result.result.totalDeltaMinor, -200);
  assert.equal(db.get<{ quantity: number }>("SELECT quantity FROM invoice_items")?.quantity, 3);
  assert.equal(db.get<{ total_minor: number; status: string }>("SELECT total_minor,status FROM invoices")?.total_minor, 300);
  assert.equal(db.get<{ adjustment_type: string }>("SELECT adjustment_type FROM invoice_adjustments")?.adjustment_type, "edit");
});

test("cancel restores stock and voids unpaid invoices; paid cancel requires and records completed refund", async () => {
  const db = seed({ balance: 3 });
  db.run("INSERT INTO stock_operations VALUES ('old-op','tenant','point_of_sale','old-key','invoice','invoice','user','', '{}',1)");
  db.run("INSERT INTO stock_movements VALUES ('old-movement','tenant','old-op','item','warehouse',NULL,'pos_deduction',-2,100,'invoice','invoice','sale','user',1)");
  const result = await resolveOfflineConflict(db as unknown as D1Database, input(db, "cancel", "cancel-key"));
  assert.equal(result.result.refundRecorded, false);
  assert.equal(db.get<{ quantity_on_hand: number }>("SELECT quantity_on_hand FROM inventory_balances")?.quantity_on_hand, 5);
  assert.equal(db.get<{ status: string }>("SELECT status FROM invoices")?.status, "void");
  assert.equal(db.get<{ adjustment_type: string }>("SELECT adjustment_type FROM invoice_adjustments")?.adjustment_type, "cancel");
  const paid = seed({ balance: 3, paid: 500 });
  await assert.rejects(resolveOfflineConflict(paid as unknown as D1Database, input(paid, "cancel", "paid-cancel-missing")), /offline_conflict_refund_required/);
  assert.equal(paid.get<{ status: string }>("SELECT status FROM invoices")?.status, "issued");
  paid.run("UPDATE invoice_payments SET amount_minor = 400");
  await assert.rejects(resolveOfflineConflict(paid as unknown as D1Database, input(paid, "cancel", "paid-cancel-mismatch", { refundReference: "REF-2026-001", refundCompleted: true })), /offline_conflict_refund_reconciliation_failed/);
  assert.equal(paid.get<{ status: string }>("SELECT status FROM invoices")?.status, "issued");
  paid.run("UPDATE invoice_payments SET amount_minor = 500");
  const refundInput = input(paid, "cancel", "paid-cancel", { refundReference: "REF-2026-001", refundCompleted: true });
  const refunded = await resolveOfflineConflict(paid as unknown as D1Database, refundInput);
  assert.equal(refunded.result.refundRecorded, true);
  assert.equal(refunded.result.refundedPaymentMinor, 500);
  assert.equal(paid.get<{ status: string }>("SELECT status FROM invoices")?.status, "void");
  assert.equal(paid.get<{ reversed_at: number | null; reversal_reason: string | null }>("SELECT reversed_at,reversal_reason FROM invoice_payments")?.reversed_at !== null, true);
  const refundAudit = paid.get<{ metadata_json: string }>("SELECT metadata_json FROM invoice_adjustments WHERE adjustment_type='cancel'");
  assert.match(refundAudit?.metadata_json ?? "", /REF-2026-001/);
  assert.equal(paid.get<{ amount_delta_minor: number; payment_method: string }>("SELECT amount_delta_minor,payment_method FROM shift_settlement_adjustments")?.amount_delta_minor, -500);
  assert.equal(paid.get<{ payment_method: string }>("SELECT amount_delta_minor,payment_method FROM shift_settlement_adjustments")?.payment_method, "cash");
  assert.equal((await resolveOfflineConflict(paid as unknown as D1Database, refundInput)).replayed, true);
  assert.equal(paid.get<{ count: number }>("SELECT COUNT(*) count FROM invoice_adjustments WHERE adjustment_type='cancel'")?.count, 1);
});

test("concurrent conflicting keys cannot both resolve the same conflict and failed stock is atomic", async () => {
  const db = seed({ balance: 0 });
  const results = await Promise.allSettled([
    resolveOfflineConflict(db as unknown as D1Database, input(db, "retry", "race-a", { replacementQuantity: 5 })),
    resolveOfflineConflict(db as unknown as D1Database, input(db, "retry", "race-b", { replacementQuantity: 5 })),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 0);
  assert.equal(db.get<{ count: number }>("SELECT COUNT(*) count FROM offline_conflict_actions")?.count, 0);
  const failed = seed({ balance: 3 });
  await assert.rejects(resolveOfflineConflict(failed as unknown as D1Database, input(failed, "retry", "short-key", { replacementQuantity: 2 })), /تغير العجز/);
  assert.equal(failed.get<{ count: number }>("SELECT COUNT(*) count FROM stock_movements")?.count, 0);
  assert.equal(failed.get<{ resolution: string }>("SELECT resolution FROM offline_stock_conflicts")?.resolution, "pending");
});
