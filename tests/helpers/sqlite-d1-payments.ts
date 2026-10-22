import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function sqliteBindings(values: unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
    throw new TypeError("Unsupported SQLite binding value");
  });
}

type LocalStatement = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => LocalStatement;
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
};

type SeedOptions = {
  contractStatus?: "active" | "cancelled" | "defaulted" | null;
  includeSchedules?: boolean;
};

export class SqliteD1Payments {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor(options: SeedOptions = {}) {
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.sqlite.exec(`
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        total_minor INTEGER NOT NULL,
        paid_minor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        payment_method TEXT,
        paid_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE installment_contracts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
      CREATE TABLE installment_schedules (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        installment_number INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        amount_minor INTEGER NOT NULL,
        paid_minor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unpaid',
        paid_at INTEGER,
        paid_by TEXT,
        payment_method TEXT,
        reference TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES installment_contracts(id),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
      CREATE TABLE customer_cheques (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        invoice_id TEXT,
        amount_minor INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE TABLE invoice_payments (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        received_by TEXT,
        amount_minor INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        reference TEXT,
        idempotency_key TEXT NOT NULL,
        idempotency_payload_hash TEXT,
        created_at INTEGER NOT NULL,
        customer_cheque_id TEXT,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
      CREATE UNIQUE INDEX invoice_payments_tenant_idempotency_uq
        ON invoice_payments (tenant_id, idempotency_key);
      CREATE TRIGGER invoice_payment_reserve_pending_customer_checks
      BEFORE INSERT ON invoice_payments
      WHEN NEW.customer_cheque_id IS NULL
        AND EXISTS (
          SELECT 1 FROM customer_cheques c
          WHERE c.tenant_id = NEW.tenant_id
            AND c.invoice_id = NEW.invoice_id
            AND c.status = 'pending'
        )
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.id = NEW.invoice_id
            AND i.tenant_id = NEW.tenant_id
            AND i.paid_minor <= i.total_minor - COALESCE((
              SELECT SUM(c.amount_minor) FROM customer_cheques c
              WHERE c.tenant_id = NEW.tenant_id
                AND c.invoice_id = NEW.invoice_id
                AND c.status = 'pending'
            ), 0)
        ) THEN RAISE(ABORT, 'INVOICE_PAYMENT_RESERVED_FOR_CHECK') END;
      END;
    `);
    this.seed(options);
  }

  seed(options: SeedOptions = {}): void {
    this.sqlite.exec("DELETE FROM invoice_payments; DELETE FROM customer_cheques; DELETE FROM installment_schedules; DELETE FROM installment_contracts; DELETE FROM invoices;");
    this.sqlite.prepare("INSERT INTO invoices (id, tenant_id, customer_id, branch_id, total_minor, paid_minor, status, updated_at) VALUES ('invoice', 'tenant', 'customer', 'branch', 3000, 0, 'issued', 1)").run();
    if (options.contractStatus !== null) {
      const status = options.contractStatus ?? "active";
      this.sqlite.prepare("INSERT INTO installment_contracts (id, tenant_id, invoice_id, customer_id, status) VALUES ('contract', 'tenant', 'invoice', 'customer', ?)").run(status);
      if (options.includeSchedules !== false) {
        this.insertSchedule("s1", 1, 1000);
        this.insertSchedule("s2", 2, 2000);
      }
    }
  }

  insertSchedule(id: string, installmentNumber: number, amountMinor: number, invoiceId = "invoice", tenantId = "tenant", contractId = "contract", paidMinor = 0, status = "unpaid"): void {
    this.sqlite.prepare(`INSERT INTO installment_schedules
      (id, tenant_id, contract_id, invoice_id, installment_number, due_at, amount_minor, paid_minor, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 1, 1)`).run(id, tenantId, contractId, invoiceId, installmentNumber, amountMinor, paidMinor, status);
  }

  insertPendingCheque(amountMinor: number, invoiceId = "invoice"): void {
    this.sqlite.prepare("INSERT INTO customer_cheques (id, tenant_id, invoice_id, amount_minor, status) VALUES ('cheque', 'tenant', ?, ?, 'pending')").run(invoiceId, amountMinor);
  }

  makeScheduleStaleAfterInvoiceUpdate(scheduleId = "s2"): void {
    this.sqlite.exec(`CREATE TRIGGER stale_schedule_after_invoice_update
      AFTER UPDATE OF paid_minor ON invoices
      WHEN NEW.id = 'invoice'
      BEGIN
        UPDATE installment_schedules SET paid_minor = amount_minor, status = 'paid' WHERE id = '${scheduleId}';
      END;`);
  }

  prepare(sql: string): D1PreparedStatement {
    const statement: LocalStatement = {
      sql,
      values: [],
      bind: (...values: unknown[]) => {
        statement.values = values;
        return statement;
      },
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...sqliteBindings(statement.values)).map((row) => ({ ...row })) as T[] }),
      first: async <T>() => {
        const row = this.sqlite.prepare(sql).get(...sqliteBindings(statement.values));
        return row ? ({ ...row } as T) : null;
      },
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.sqlite.exec("BEGIN");
    try {
      const results: Array<{ meta: { changes: number } }> = [];
      for (const rawStatement of statements) {
        const statement = rawStatement as unknown as LocalStatement;
        const result = this.sqlite.prepare(statement.sql).run(...sqliteBindings(statement.values));
        results.push({ meta: { changes: Number(result.changes) } });
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  get<T>(sql: string, ...values: unknown[]): T | null {
    const row = this.sqlite.prepare(sql).get(...sqliteBindings(values));
    return row ? ({ ...row } as T) : null;
  }

  all<T>(sql: string, ...values: unknown[]): T[] {
    return this.sqlite.prepare(sql).all(...sqliteBindings(values)).map((row) => ({ ...row })) as T[];
  }

  close(): void {
    this.sqlite.close();
  }
}
