import test from "node:test";
import assert from "node:assert/strict";
import { applyInvoicePayment } from "../lib/operations/invoice-payment";
import { SqliteD1Payments } from "./helpers/sqlite-d1-payments";

type Row = { id: string; amountMinor: number; paidMinor: number; status: "unpaid" | "paid" };
type ContractStatus = "active" | "cancelled" | "defaulted";

type Statement = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => Statement;
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
};

class MemoryD1 {
  invoice = { totalMinor: 3_000, paidMinor: 0, status: "issued" as "issued" | "partially_paid" | "paid" };
  contractStatus: ContractStatus | null = "active";
  schedules: Row[] = [
    { id: "s1", amountMinor: 1_000, paidMinor: 0, status: "unpaid" },
    { id: "s2", amountMinor: 2_000, paidMinor: 0, status: "unpaid" },
  ];
  payments: Array<{ key: string; hash: string; amountMinor: number }> = [];
  prepare(sql: string): Statement {
    const statement: Statement = {
      sql,
      values: [],
      bind: (...values: unknown[]) => { statement.values = values; return statement; },
      all: async <T>() => {
        if (!sql.startsWith("SELECT s.id, s.amount_minor")) return { results: [] as T[] };
        if (this.contractStatus !== "active") return { results: [] as T[] };
        const [first, second, third] = statement.values as string[];
        const rows = statement.values.length === 3
          ? this.schedules.filter((row) => row.id === first && row.status === "unpaid" && second === "tenant" && third === "invoice")
          : this.schedules.filter((row) => row.status === "unpaid" && first === "tenant" && second === "invoice");
        return { results: rows.map((row) => ({ id: row.id, amountMinor: row.amountMinor, paidMinor: row.paidMinor })) as T[] };
      },
      first: async <T>() => {
        if (sql.startsWith("SELECT status")) return (this.contractStatus ? { status: this.contractStatus } : null) as T;
        if (!sql.startsWith("SELECT invoice_id")) return null;
        const key = statement.values[1] as string;
        const row = this.payments.find((payment) => payment.key === key);
        return row ? ({ invoiceId: "invoice", payloadHash: row.hash } as T) : null;
      },
    };
    return statement;
  }
  async batch(statements: readonly Statement[]): Promise<Array<{ meta: { changes: number } }>> {
    const invoiceSnapshot = { ...this.invoice };
    const schedulesSnapshot = this.schedules.map((row) => ({ ...row }));
    const paymentsSnapshot = [...this.payments];
    const results: Array<{ meta: { changes: number } }> = [];
    try {
      let lastChanges = 0;
      for (const statement of statements) {
        let changes = 0;
        if (statement.sql.startsWith("UPDATE invoices")) {
          const amount = statement.values[0] as number;
          if (["issued", "partially_paid"].includes(this.invoice.status) && this.invoice.paidMinor + amount <= this.invoice.totalMinor && this.contractStatus !== "cancelled" && this.contractStatus !== "defaulted") {
            this.invoice.paidMinor += amount;
            this.invoice.status = this.invoice.paidMinor === this.invoice.totalMinor ? "paid" : "partially_paid";
            changes = 1;
          }
        } else if (statement.sql.startsWith("UPDATE installment_schedules")) {
          const amount = statement.values[0] as number;
          const id = statement.values[8] as string;
          const row = this.schedules.find((candidate) => candidate.id === id);
          if (row && this.contractStatus === "active" && row.status === "unpaid" && row.paidMinor + amount <= row.amountMinor) {
            row.paidMinor += amount;
            row.status = row.paidMinor === row.amountMinor ? "paid" : "unpaid";
            changes = 1;
          }
        } else if (statement.sql.startsWith("INSERT INTO invoice_payments") && statement.sql.includes("WHERE changes() <> 1")) {
          if (lastChanges !== 1) throw new Error("FOREIGN KEY constraint failed");
        } else if (statement.sql.startsWith("INSERT INTO invoice_payments") && lastChanges === 1) {
          const key = statement.values[7] as string;
          if (this.payments.some((payment) => payment.key === key)) throw new Error("UNIQUE");
          this.payments.push({ key, hash: statement.values[8] as string, amountMinor: statement.values[4] as number });
          changes = 1;
        }
        results.push({ meta: { changes } });
        lastChanges = changes;
      }
      return results;
    } catch (error) {
      this.invoice = invoiceSnapshot;
      this.schedules = schedulesSnapshot;
      this.payments = paymentsSnapshot;
      throw error;
    }
  }
}

function input(db: MemoryD1, key: string, amountMinor: number, hash = key) {
  return { db: db as unknown as D1Database, tenantId: "tenant", invoiceId: "invoice", userId: "user", amountMinor, method: "cash" as const, reference: null, idempotencyKey: key, payloadHash: hash };
}

test("يوزع الدفع الجزئي والكامل على جدول الأقساط بترتيب الاستحقاق", async () => {
  const db = new MemoryD1();
  await applyInvoicePayment(input(db, "partial", 500));
  assert.equal(db.invoice.paidMinor, 500);
  assert.deepEqual(db.schedules.map((row) => row.paidMinor), [500, 0]);
  await applyInvoicePayment(input(db, "full", 2_500));
  assert.equal(db.invoice.status, "paid");
  assert.deepEqual(db.schedules.map((row) => row.status), ["paid", "paid"]);
  assert.deepEqual(db.schedules.map((row) => row.paidMinor), [1_000, 2_000]);
});

test("يرفض التجاوز دون تغيير الفاتورة أو الجدول", async () => {
  const db = new MemoryD1();
  await assert.rejects(() => applyInvoicePayment(input(db, "excess", 3_001)), /يتجاوز/);
  assert.equal(db.invoice.paidMinor, 0);
  assert.deepEqual(db.schedules.map((row) => row.paidMinor), [0, 0]);
});

test("الطلب المكرر يعاد بأمان ولا يضاعف التحصيل", async () => {
  const db = new MemoryD1();
  const first = await applyInvoicePayment(input(db, "same", 500));
  const replay = await applyInvoicePayment(input(db, "same", 500));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(db.invoice.paidMinor, 500);
  assert.equal(db.payments.length, 1);
});

test("دفعة invoice العامة ترفض العقد الملغى أو المتعثر ولا تسجل تحصيلاً غير موزع", async () => {
  for (const status of ["cancelled", "defaulted"] as const) {
    const db = new MemoryD1();
    db.contractStatus = status;
    await assert.rejects(() => applyInvoicePayment(input(db, `${status}-payment`, 500)), /غير نشط/);
    assert.equal(db.invoice.paidMinor, 0);
    assert.deepEqual(db.schedules.map((row) => row.paidMinor), [0, 0]);
    assert.equal(db.payments.length, 0);
  }
});

test("دفعة invoice بلا عقد تقسيط مسموحة كتحصيل عام بلا توزيع", async () => {
  const db = new MemoryD1();
  db.contractStatus = null;
  db.schedules = [];
  const result = await applyInvoicePayment(input(db, "general-payment", 500));
  assert.equal(result.replayed, false);
  assert.equal(db.invoice.paidMinor, 500);
  assert.equal(db.payments.length, 1);
});

test("تكرار الدفعة الجزئية والكاملة لا يضاعف الرصيد أو سجل الدفعات", async () => {
  const db = new MemoryD1();
  const partial = await applyInvoicePayment(input(db, "partial-duplicate", 500));
  const partialReplay = await applyInvoicePayment(input(db, "partial-duplicate", 500));
  const full = await applyInvoicePayment(input(db, "full-duplicate", 2_500));
  const fullReplay = await applyInvoicePayment(input(db, "full-duplicate", 2_500));
  assert.equal(partial.replayed, false);
  assert.equal(partialReplay.replayed, true);
  assert.equal(full.replayed, false);
  assert.equal(fullReplay.replayed, true);
  assert.equal(db.invoice.paidMinor, 3_000);
  assert.equal(db.payments.length, 2);
});

test("الطلب المتزامن الثاني يفشل بالحارس الذري ولا يضاعف الرصيد", async () => {
  const db = new MemoryD1();
  const results = await Promise.allSettled([applyInvoicePayment(input(db, "race-a", 2_500)), applyInvoicePayment(input(db, "race-b", 2_500))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(db.invoice.paidMinor, 2_500);
  assert.equal(db.payments.length, 1);
});

function sqliteInput(db: SqliteD1Payments, key: string, amountMinor: number, hash = key) {
  return { db: db as unknown as D1Database, tenantId: "tenant", invoiceId: "invoice", userId: "user", amountMinor, method: "cash" as const, reference: null, idempotencyKey: key, payloadHash: hash };
}

test("SQLite الحقيقي يوزع الدفعة الجزئية ثم الكاملة دون مضاعفة", async () => {
  const db = new SqliteD1Payments();
  try {
    await applyInvoicePayment(sqliteInput(db, "sqlite-partial", 500));
    assert.deepEqual(db.get("SELECT paid_minor AS paidMinor, status FROM invoices WHERE id = 'invoice'"), { paidMinor: 500, status: "partially_paid" });
    assert.deepEqual(db.all("SELECT paid_minor AS paidMinor, status FROM installment_schedules ORDER BY installment_number"), [
      { paidMinor: 500, status: "unpaid" },
      { paidMinor: 0, status: "unpaid" },
    ]);
    await applyInvoicePayment(sqliteInput(db, "sqlite-full", 2500));
    assert.deepEqual(db.get("SELECT paid_minor AS paidMinor, status FROM invoices WHERE id = 'invoice'"), { paidMinor: 3000, status: "paid" });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payments")?.count, 2);
  } finally {
    db.close();
  }
});

test("SQLite الحقيقي يحترم tenant/invoice/idempotency ولا يضاعف replay", async () => {
  const db = new SqliteD1Payments();
  try {
    const first = await applyInvoicePayment(sqliteInput(db, "sqlite-same", 500));
    const replay = await applyInvoicePayment(sqliteInput(db, "sqlite-same", 500));
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(db.get<{ paidMinor: number }>("SELECT paid_minor AS paidMinor FROM invoices WHERE id = 'invoice'")?.paidMinor, 500);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payments")?.count, 1);
  } finally {
    db.close();
  }
});

test("SQLite الحقيقي يعيد الفاتورة والأقساط معاً عند تقادم قسط بعد تحديث الفاتورة", async () => {
  const db = new SqliteD1Payments();
  try {
    db.makeScheduleStaleAfterInvoiceUpdate();
    await assert.rejects(() => applyInvoicePayment(sqliteInput(db, "sqlite-stale", 1500)), /FOREIGN KEY|تغير رصيد/);
    assert.deepEqual(db.get("SELECT paid_minor AS paidMinor, status FROM invoices WHERE id = 'invoice'"), { paidMinor: 0, status: "issued" });
    assert.deepEqual(db.all("SELECT paid_minor AS paidMinor, status FROM installment_schedules ORDER BY installment_number"), [
      { paidMinor: 0, status: "unpaid" },
      { paidMinor: 0, status: "unpaid" },
    ]);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payments")?.count, 0);
  } finally {
    db.close();
  }
});

test("SQLite الحقيقي يرفض cancelled/defaulted وpending customer cheque بلا mutation", async () => {
  for (const contractStatus of ["cancelled", "defaulted"] as const) {
    const db = new SqliteD1Payments({ contractStatus });
    try {
      await assert.rejects(() => applyInvoicePayment(sqliteInput(db, `sqlite-${contractStatus}`, 500)), /غير نشط/);
      assert.equal(db.get<{ paidMinor: number }>("SELECT paid_minor AS paidMinor FROM invoices WHERE id = 'invoice'")?.paidMinor, 0);
      assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payments")?.count, 0);
    } finally {
      db.close();
    }
  }

  const db = new SqliteD1Payments();
  try {
    db.insertPendingCheque(500);
    await assert.rejects(() => applyInvoicePayment(sqliteInput(db, "sqlite-reserved", 2600)), /FOREIGN KEY|تغير رصيد/);
    assert.equal(db.get<{ paidMinor: number }>("SELECT paid_minor AS paidMinor FROM invoices WHERE id = 'invoice'")?.paidMinor, 0);
    assert.deepEqual(db.all("SELECT paid_minor AS paidMinor FROM installment_schedules ORDER BY installment_number"), [{ paidMinor: 0 }, { paidMinor: 0 }]);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payments")?.count, 0);
  } finally {
    db.close();
  }
});
