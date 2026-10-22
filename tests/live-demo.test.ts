import assert from "node:assert/strict";
import test from "node:test";
import { readSession } from "../lib/auth";
import { createLiveDemo, liveDemoCatalogCounts, type LiveDemoEnv } from "../lib/demo/provision";

type Prepared = { sql: string; values: unknown[]; bind: (...values: unknown[]) => Prepared; first: () => Promise<unknown>; all: () => Promise<unknown>; run: () => Promise<unknown> };

function mockEnv(options: { rateKey?: string; expiredRows?: Array<{ id: string; user_id: string | null }> } = {}) {
  const seedBatches: Prepared[][] = [];
  const prepared: Prepared[] = [];
  const kvValues = new Map<string, string>();
  if (options.rateKey) kvValues.set(options.rateKey, "5");
  if (options.expiredRows?.some((row) => row.user_id === "expired-demo-user")) {
    kvValues.set("session:expired-demo-user", "active");
    kvValues.set("auth-generation:expired-demo-user", "old-generation");
  }
  const DB = {
    prepare(sql: string): Prepared {
      const statement: Prepared = {
        sql,
        values: [],
        bind(...values: unknown[]) { this.values = values; return this; },
        async first() { return { count: 0 }; },
        async all() { return { results: options.expiredRows ?? [] }; },
        async run() { return { success: true }; },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements: Prepared[]) {
      seedBatches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
  const KV_BINDING = {
    async get(key: string) { return kvValues.get(key) ?? null; },
    async put(key: string, value: string) { kvValues.set(key, value); },
    async delete(key: string) { kvValues.delete(key); },
  } as unknown as KVNamespace;
  const env = { DB, KV_BINDING, SESSION_SECRET: "x".repeat(48) } as LiveDemoEnv;
  return { env, seedBatches, prepared, kvValues };
}

function request(urlOrigin = "https://qutoof.example", requestOrigin = urlOrigin, cookie?: string) {
  const headers = new Headers({ Origin: requestOrigin, "CF-Connecting-IP": "198.51.100.42", "Content-Type": "application/json" });
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`${urlOrigin}/api/public/live-demo`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

async function demoRateKey(): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("198.51.100.42"));
  return `live-demo-rate:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("demo seed is synthetic, bounded, and includes categories, stock, customers and completed sales", () => {
  assert.deepEqual(liveDemoCatalogCounts, { categories: 4, products: 8, customers: 5, sales: 4, maxActiveDemos: 250, sessionTtlSeconds: 3600 });
});

test("public demo provisioning seeds an isolated tenant and returns a short-lived authenticated session", async () => {
  const { env, seedBatches, prepared, kvValues } = mockEnv();
  const response = await createLiveDemo(request(), env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=3600/);
  const payload = await response.json() as { redirectTo: string; expiresAt: number };
  assert.equal(payload.redirectTo, "/dashboard/pos");
  assert.ok(payload.expiresAt > Date.now());
  assert.equal(seedBatches.length, 1);
  assert.ok(seedBatches[0].length < 100, "one D1 batch stays below the per-batch statement cap");

  const inserts = seedBatches[0];
  for (const statement of inserts) assert.equal((statement.sql.match(/\?/g) ?? []).length, statement.values.length, `binding count for ${statement.sql.slice(0, 70)}`);
  const inventoryRows = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO inventory_items"));
  const stockRows = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO inventory_balances"));
  const customers = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO customers"));
  const invoices = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO invoices"));
  const invoiceLines = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO invoice_items"));
  const payments = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO invoice_payments"));
  const stockOperations = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO stock_operations"));
  const stockMovements = inserts.filter((statement) => statement.sql.startsWith("INSERT INTO stock_movements"));
  assert.equal(inventoryRows.length, 8);
  assert.equal(stockRows.length, 8);
  assert.equal(customers.length, 5);
  assert.equal(invoices.length, 4);
  assert.ok(invoiceLines.length >= 4);
  assert.equal(payments.length, 4);
  assert.equal(stockOperations.length, 12);
  assert.equal(stockMovements.length, 17);
  assert.equal(stockMovements.reduce((sum, movement) => sum + Number(movement.values[5]), 0), 268);
  assert.ok(stockMovements.some((movement) => movement.sql.includes("'pos_deduction'")));
  assert.ok(customers.every((row) => row.values.some((value) => String(value).endsWith(".invalid"))));
  assert.ok(customers.every((row) => row.values.some((value) => String(value).startsWith("DEMO-"))));
  assert.ok(inserts.some((row) => row.sql.startsWith("INSERT INTO tenants") && String(row.values[3]).includes("qutoof-live-demo-v1")));

  const cookie = response.headers.get("set-cookie") ?? "";
  const token = cookie.match(/qutoof_session=([^;]+)/)?.[1];
  assert.ok(token);
  const session = await readSession(token, env.SESSION_SECRET!);
  assert.ok(session);
  assert.equal(session.role, "business_admin");
  assert.ok(session.tenantId);
  assert.equal(kvValues.get(`session:${session.sub}`), "active");
  assert.ok(prepared.some((statement) => statement.sql.includes("COUNT(*) AS count")));
});

test("live demo enforces origin and request-rate checks before writing tenant data", async () => {
  const forbidden = mockEnv();
  const crossOrigin = await createLiveDemo(request("https://qutoof.example", "https://attacker.invalid"), forbidden.env);
  assert.equal(crossOrigin.status, 403);
  assert.equal(forbidden.seedBatches.length, 0);

  const returningVisitor = mockEnv();
  const withExistingSessionCookie = await createLiveDemo(request("https://qutoof.example", "https://qutoof.example", "qutoof_session=existing"), returningVisitor.env);
  assert.equal(withExistingSessionCookie.status, 201);
  assert.equal(returningVisitor.seedBatches.length, 1);
  assert.match(withExistingSessionCookie.headers.get("set-cookie") ?? "", /^qutoof_session=/);
  const demoToken = withExistingSessionCookie.headers.get("set-cookie")?.match(/qutoof_session=([^;]+)/)?.[1];
  assert.ok(demoToken);
  const demoSession = await readSession(demoToken, returningVisitor.env.SESSION_SECRET!);
  assert.equal(demoSession?.role, "business_admin");
  assert.ok(demoSession?.tenantId);

  const limited = mockEnv({ rateKey: await demoRateKey() });
  const tooMany = await createLiveDemo(request(), limited.env);
  assert.equal(tooMany.status, 429);
  assert.equal(limited.seedBatches.length, 0);
});

test("expired demos are archived and their user session markers are revoked safely", async () => {
  const { env, seedBatches, kvValues } = mockEnv({ expiredRows: [{ id: "expired-demo-tenant", user_id: "expired-demo-user" }] });
  const response = await createLiveDemo(request(), env);
  assert.equal(response.status, 201);
  assert.equal(seedBatches.length, 2);
  const archive = seedBatches[0];
  assert.equal(archive.length, 2);
  assert.ok(archive.some((statement) => statement.sql.includes("UPDATE users SET is_active = 0")));
  assert.ok(archive.some((statement) => statement.sql.includes("status = 'expired'") && statement.sql.includes("json_set")));
  assert.equal(kvValues.has("session:expired-demo-user"), false);
  assert.equal(kvValues.has("auth-generation:expired-demo-user"), false);
});


test("live demo seed obeys the complete migrated SQLite schema and stock ledger triggers", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const db = new DatabaseSync(":memory:");
  let sqlFailure: unknown;
  db.exec("PRAGMA foreign_keys = ON");
  try {
    const migrations = readdirSync(join(process.cwd(), "drizzle/migrations")).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = readFileSync(join(process.cwd(), "drizzle/migrations", migration), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
    }

    type SqlStatement = Prepared;
    const DB = {
      prepare(sql: string): SqlStatement {
        return {
          sql,
          values: [],
          bind(...values: unknown[]) { this.values = values; return this; },
          async first() { try { return db.prepare(sql).get(...this.values as never[]) ?? null; } catch (error) { sqlFailure = error; throw error; } },
          async all() { try { return { results: db.prepare(sql).all(...this.values as never[]) }; } catch (error) { sqlFailure = error; throw error; } },
          async run() { try { db.prepare(sql).run(...this.values as never[]); return { success: true }; } catch (error) { sqlFailure = error; throw error; } },
        };
      },
      async batch(statements: SqlStatement[]) {
        db.exec("BEGIN");
        try {
          for (const statement of statements) db.prepare(statement.sql).run(...statement.values as never[]);
          db.exec("COMMIT");
          return statements.map(() => ({ success: true }));
        } catch (error) {
          db.exec("ROLLBACK");
          sqlFailure = error;
          throw error;
        }
      },
    } as unknown as D1Database;
    const kvValues = new Map<string, string>();
    const KV_BINDING = {
      async get(key: string) { return kvValues.get(key) ?? null; },
      async put(key: string, value: string) { kvValues.set(key, value); },
      async delete(key: string) { kvValues.delete(key); },
    } as unknown as KVNamespace;
    const env = { DB, KV_BINDING, SESSION_SECRET: "x".repeat(48) } as LiveDemoEnv;
    const firstResponse = await createLiveDemo(request(), env);
    assert.equal(firstResponse.status, 201, String(sqlFailure));
    const cookie = firstResponse.headers.get("set-cookie") ?? "";
    const token = cookie.match(/qutoof_session=([^;]+)/)?.[1];
    assert.ok(token);
    const firstSession = await readSession(token, env.SESSION_SECRET!);
    assert.ok(firstSession?.tenantId);

    const stats = db.prepare("SELECT (SELECT COUNT(*) FROM inventory_items WHERE tenant_id = ?) AS products, (SELECT COUNT(*) FROM customers WHERE tenant_id = ?) AS customers, (SELECT COUNT(*) FROM invoices WHERE tenant_id = ?) AS invoices, (SELECT COUNT(*) FROM invoice_items WHERE tenant_id = ?) AS lines, (SELECT SUM(quantity_on_hand) FROM inventory_balances WHERE tenant_id = ?) AS stock, (SELECT SUM(quantity_delta) FROM stock_movements WHERE tenant_id = ?) AS netMovement").get(firstSession.tenantId, firstSession.tenantId, firstSession.tenantId, firstSession.tenantId, firstSession.tenantId, firstSession.tenantId) as { products: number; customers: number; invoices: number; lines: number; stock: number; netMovement: number };
    assert.deepEqual({ ...stats }, { products: 8, customers: 5, invoices: 4, lines: 9, stock: 268, netMovement: 268 });
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    db.prepare("UPDATE tenants SET settings_json = json_set(settings_json, '$.liveDemo.expiresAt', 0) WHERE id = ?").run(firstSession.tenantId);
    const secondResponse = await createLiveDemo(request(), env);
    assert.equal(secondResponse.status, 201);
    assert.equal(db.prepare("SELECT status FROM tenants WHERE id = ?").get(firstSession.tenantId)?.status, "expired");
    assert.equal(db.prepare("SELECT is_active AS active FROM users WHERE id = ?").get(firstSession.sub)?.active, 0);
    assert.equal(kvValues.has(`session:${firstSession.sub}`), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE tenant_id = ?").get(firstSession.tenantId)?.count, 17);
  } finally {
    db.close();
  }
});
