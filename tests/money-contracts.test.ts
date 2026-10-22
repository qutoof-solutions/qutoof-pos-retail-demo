import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("SQLite unified money report counts payments by payment date and branch", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE invoice_payments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL, payment_method TEXT NOT NULL, amount_minor INTEGER NOT NULL, reversed_at INTEGER, created_at INTEGER NOT NULL);
      INSERT INTO invoices VALUES ('old', 'tenant', 'branch', 'issued'), ('new', 'tenant', 'branch', 'issued'), ('void', 'tenant', 'branch', 'void');
      INSERT INTO invoice_payments VALUES ('before', 'tenant', 'old', 'cash', 700, NULL, 900), ('inside-old', 'tenant', 'old', 'cash', 1200, NULL, 1500), ('inside-new', 'tenant', 'new', 'card', 800, NULL, 1600), ('inside-void', 'tenant', 'void', 'cash', 999, NULL, 1700), ('reversed', 'tenant', 'new', 'cash', 500, 1800, 1700);
    `);
    const rows = (db.prepare(`SELECT p.payment_method AS paymentMethod, COUNT(*) AS count, COALESCE(SUM(p.amount_minor), 0) AS totalMinor
      FROM invoice_payments p INNER JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at < ? AND p.reversed_at IS NULL AND i.status <> 'void' AND i.branch_id IN (?)
      GROUP BY p.payment_method ORDER BY p.payment_method`).all("tenant", 1000, 2000, "branch") as Array<{ paymentMethod: string; count: number; totalMinor: number }>).map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { paymentMethod: "card", count: 1, totalMinor: 800 },
      { paymentMethod: "cash", count: 1, totalMinor: 1200 },
    ]);
  } finally {
    db.close();
  }
});

test("SQLite Z-report contract keeps closed timestamps in milliseconds and reconciles line differences", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE shift_settlements (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, status TEXT NOT NULL, closed_at INTEGER, cash_difference_minor INTEGER);
      CREATE TABLE shift_settlement_lines (settlement_id TEXT NOT NULL, payment_method TEXT NOT NULL, expected_minor INTEGER NOT NULL, collected_minor INTEGER NOT NULL, difference_minor INTEGER NOT NULL);
      INSERT INTO shift_settlements VALUES ('s1', 'tenant', 'branch', 'closed', 1500, -25), ('s2', 'tenant', 'branch', 'closed', 900, 100);
      INSERT INTO shift_settlement_lines VALUES ('s1', 'cash', 1000, 975, -25), ('s1', 'card', 500, 500, 0);
    `);
    const summary = { ...(db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(cash_difference_minor), 0) AS differenceMinor FROM shift_settlements WHERE tenant_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? AND branch_id IN (?)`).get("tenant", 1000, 2000, "branch") as { count: number; differenceMinor: number }) };
    assert.deepEqual(summary, { count: 1, differenceMinor: -25 });
    const lines = (db.prepare("SELECT payment_method AS paymentMethod, expected_minor AS expectedMinor, collected_minor AS collectedMinor, difference_minor AS differenceMinor FROM shift_settlement_lines WHERE settlement_id = 's1' ORDER BY payment_method").all() as Array<{ paymentMethod: string; expectedMinor: number; collectedMinor: number; differenceMinor: number }>).map((row) => ({ ...row }));
    assert.deepEqual(lines, [
      { paymentMethod: "card", expectedMinor: 500, collectedMinor: 500, differenceMinor: 0 },
      { paymentMethod: "cash", expectedMinor: 1000, collectedMinor: 975, differenceMinor: -25 },
    ]);
  } finally {
    db.close();
  }
});
