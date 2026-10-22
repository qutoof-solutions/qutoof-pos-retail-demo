import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  assertPreviousMutationChanged,
  currentAppointmentExists,
  currentGateAppointmentExists,
  type GateAppointmentSnapshot,
} from "../lib/operations/gate-mutation";

const dialect = new SQLiteSyncDialect();
const tenantId = "tenant-a";
const appointmentId = "appointment-a";
const ticketId = "ticket-a";
const branchId = "branch-a";
const oldStartsAt = new Date("2026-10-19T12:30:00.000Z");
const oldEndsAt = new Date("2026-10-19T13:30:00.000Z");
const oldExpiresAt = new Date("2026-10-19T14:00:00.000Z");

function epoch(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      branch_id TEXT,
      status TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL
    );
    CREATE TABLE digital_tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

function snapshot(overrides: Partial<GateAppointmentSnapshot> = {}): GateAppointmentSnapshot {
  return {
    tenantId,
    id: appointmentId,
    branchId,
    status: "confirmed",
    startsAt: oldStartsAt,
    endsAt: oldEndsAt,
    ...overrides,
  };
}

function compile(statement: ReturnType<typeof sql>) {
  return dialect.sqlToQuery(statement);
}

function run(db: DatabaseSync, statement: ReturnType<typeof sql>) {
  const query = compile(statement);
  return db.prepare(query.sql).run(...(query.params as SQLInputValue[]));
}

function get<T extends Record<string, unknown>>(db: DatabaseSync, statement: string): T {
  return db.prepare(statement).get() as T;
}

function seed(db: DatabaseSync, ticketStatus = "issued", expiresAt = oldExpiresAt) {
  db.prepare("INSERT INTO appointments (id, tenant_id, branch_id, status, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)").run(appointmentId, tenantId, branchId, "confirmed", epoch(oldStartsAt), epoch(oldEndsAt));
  db.prepare("INSERT INTO digital_tickets (id, tenant_id, appointment_id, status, expires_at) VALUES (?, ?, ?, ?, ?)").run(ticketId, tenantId, appointmentId, ticketStatus, epoch(expiresAt));
}

function gateCheckIn(snapshotValue: GateAppointmentSnapshot, expiresAt = oldExpiresAt) {
  return sql`UPDATE digital_tickets SET status = 'checked_in' WHERE id = ${ticketId} AND tenant_id = ${tenantId} AND status = 'issued' AND expires_at = ${epoch(expiresAt)} AND ${currentGateAppointmentExists(snapshotValue)}`;
}

function markExpired(snapshotValue: GateAppointmentSnapshot, expiresAt = oldExpiresAt) {
  return sql`UPDATE digital_tickets SET status = 'expired' WHERE id = ${ticketId} AND tenant_id = ${tenantId} AND status = 'issued' AND expires_at = ${epoch(expiresAt)} AND ${currentGateAppointmentExists(snapshotValue)}`;
}

function atomicBatch(db: DatabaseSync, statements: ReturnType<typeof sql>[]) {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      const query = compile(statement);
      db.prepare(query.sql).run(...(query.params as SQLInputValue[]));
    }
    db.exec("COMMIT");
    return true;
  } catch {
    db.exec("ROLLBACK");
    return false;
  }
}

test("gate UPDATE rejects a QR when the appointment was cancelled after candidate SELECT", () => {
  const db = openDb();
  seed(db);
  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(appointmentId);

  const result = run(db, gateCheckIn(snapshot()));

  assert.equal(result.changes, 0);
  assert.equal(get<{ status: string }>(db, "SELECT status FROM digital_tickets WHERE id = 'ticket-a'").status, "issued");
  db.close();
});

test("gate UPDATE rejects a stale QR after reschedule changed starts and ends", () => {
  const db = openDb();
  seed(db);
  const newStartsAt = new Date("2026-10-22T12:30:00.000Z");
  const newEndsAt = new Date("2026-10-22T13:30:00.000Z");
  db.prepare("UPDATE appointments SET starts_at = ?, ends_at = ? WHERE id = ?").run(epoch(newStartsAt), epoch(newEndsAt), appointmentId);

  const result = run(db, gateCheckIn(snapshot()));

  assert.equal(result.changes, 0);
  assert.equal(get<{ status: string }>(db, "SELECT status FROM digital_tickets WHERE id = 'ticket-a'").status, "issued");
  db.close();
});

test("expired mutation cannot mark a newly rescheduled ticket expired", () => {
  const db = openDb();
  seed(db);
  const newStartsAt = new Date("2026-10-22T12:30:00.000Z");
  const newEndsAt = new Date("2026-10-22T13:30:00.000Z");
  const newExpiresAt = new Date("2026-10-22T14:00:00.000Z");
  db.prepare("UPDATE appointments SET starts_at = ?, ends_at = ? WHERE id = ?").run(epoch(newStartsAt), epoch(newEndsAt), appointmentId);
  db.prepare("UPDATE digital_tickets SET expires_at = ? WHERE id = ?").run(epoch(newExpiresAt), ticketId);

  const result = run(db, markExpired(snapshot(), oldExpiresAt));
  const currentTicket = get<{ status: string; expires_at: number }>(db, "SELECT status, expires_at FROM digital_tickets WHERE id = 'ticket-a'");

  assert.equal(result.changes, 0);
  assert.equal(currentTicket.status, "issued");
  assert.equal(currentTicket.expires_at, epoch(newExpiresAt));
  db.close();
});

test("single-use replay stays checked_in after the second guarded mutation", () => {
  const db = openDb();
  seed(db);
  assert.equal(run(db, gateCheckIn(snapshot())).changes, 1);
  assert.equal(run(db, gateCheckIn(snapshot())).changes, 0);
  assert.equal(get<{ status: string }>(db, "SELECT status FROM digital_tickets WHERE id = 'ticket-a'").status, "checked_in");
  db.close();
});

test("cancel batch rolls back the appointment when the ticket hand-off changes zero", () => {
  const db = openDb();
  seed(db, "revoked");
  const current = snapshot();

  const committed = atomicBatch(db, [
    sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${appointmentId} AND ${currentAppointmentExists(current)}`,
    sql`UPDATE digital_tickets SET status = 'revoked' WHERE id = ${ticketId} AND status = 'issued' AND changes() = 1`,
    assertPreviousMutationChanged(),
  ]);

  assert.equal(committed, false);
  assert.equal(get<{ status: string }>(db, "SELECT status FROM appointments WHERE id = 'appointment-a'").status, "confirmed");
  assert.equal(get<{ status: string }>(db, "SELECT status FROM digital_tickets WHERE id = 'ticket-a'").status, "revoked");
  db.close();
});

test("reschedule batch rolls back new appointment times when expiry hand-off changes zero", () => {
  const db = openDb();
  seed(db);
  const current = snapshot();
  const newStartsAt = new Date("2026-10-22T12:30:00.000Z");
  const newEndsAt = new Date("2026-10-22T13:30:00.000Z");
  const newExpiresAt = new Date("2026-10-22T14:00:00.000Z");
  db.prepare("UPDATE digital_tickets SET expires_at = ? WHERE id = ?").run(epoch(newExpiresAt), ticketId);

  const committed = atomicBatch(db, [
    sql`UPDATE appointments SET starts_at = ${epoch(newStartsAt)}, ends_at = ${epoch(newEndsAt)} WHERE id = ${appointmentId} AND ${currentAppointmentExists(current)}`,
    sql`UPDATE digital_tickets SET expires_at = ${epoch(newExpiresAt)} WHERE id = ${ticketId} AND status = 'issued' AND expires_at = ${epoch(oldExpiresAt)} AND changes() = 1`,
    assertPreviousMutationChanged(),
  ]);

  const appointment = get<{ starts_at: number; ends_at: number }>(db, "SELECT starts_at, ends_at FROM appointments WHERE id = 'appointment-a'");
  assert.equal(committed, false);
  assert.equal(appointment.starts_at, epoch(oldStartsAt));
  assert.equal(appointment.ends_at, epoch(oldEndsAt));
  db.close();
});
