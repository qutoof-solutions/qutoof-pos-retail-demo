import assert from "node:assert/strict";
import test from "node:test";
import {
  derivePublicDigitalTicketToken,
  digitalTicketFailure,
  digitalTicketExpiresAt,
  isDigitalTicketAppointmentEligible,
  hashDigitalTicketToken,
  type DigitalTicketAppointment,
  type DigitalTicketCheck,
} from "../lib/operations/digital-tickets";

type MemoryTicket = DigitalTicketCheck & { id: string };

const now = new Date("2026-10-19T12:00:00.000Z");
const appointment: DigitalTicketAppointment = {
  tenantId: "tenant-a",
  branchId: "branch-a",
  startsAt: new Date("2026-10-19T12:30:00.000Z"),
  endsAt: new Date("2026-10-19T13:30:00.000Z"),
  status: "confirmed",
};

function consume(ticket: MemoryTicket, expectedTenantId: string, expectedBranchId: string, current = now): boolean {
  const failure = digitalTicketFailure(ticket, appointment, expectedTenantId, expectedBranchId, current);
  if (failure) return false;
  ticket.status = "checked_in";
  return true;
}

test("public booking token is reproducible while D1 receives only its hash", async () => {
  const token = await derivePublicDigitalTicketToken("management-secret", "tenant-a", "appointment-a");
  const reopened = await derivePublicDigitalTicketToken("management-secret", "tenant-a", "appointment-a");
  const otherAppointment = await derivePublicDigitalTicketToken("management-secret", "tenant-a", "appointment-b");

  assert.equal(reopened, token);
  assert.notEqual(otherAppointment, token);
  assert.notEqual(await hashDigitalTicketToken(token), token);
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
});

test("booking-to-gate accepts once and rejects replay", () => {
  const ticket: MemoryTicket = {
    id: "ticket-a",
    tenantId: "tenant-a",
    branchId: "branch-a",
    status: "issued",
    expiresAt: new Date("2026-10-19T14:00:00.000Z"),
  };

  assert.equal(consume(ticket, "tenant-a", "branch-a"), true);
  assert.equal(ticket.status, "checked_in");
  assert.equal(consume(ticket, "tenant-a", "branch-a"), false);
  assert.equal(digitalTicketFailure(ticket, appointment, "tenant-a", "branch-a", now), "replay");
});

test("gate rejects cross-branch and cross-tenant tickets", () => {
  const ticket: MemoryTicket = {
    id: "ticket-b",
    tenantId: "tenant-a",
    branchId: "branch-a",
    status: "issued",
    expiresAt: new Date("2026-10-19T14:00:00.000Z"),
  };

  assert.equal(digitalTicketFailure(ticket, appointment, "tenant-a", "branch-b", now), "branch");
  assert.equal(digitalTicketFailure(ticket, appointment, "tenant-b", "branch-a", now), "tenant");
  assert.equal(ticket.status, "issued");
});

test("gate rejects an expired ticket before consuming it", () => {
  const ticket: MemoryTicket = {
    id: "ticket-c",
    tenantId: "tenant-a",
    branchId: "branch-a",
    status: "issued",
    expiresAt: new Date("2026-10-19T11:59:59.000Z"),
  };

  assert.equal(digitalTicketFailure(ticket, appointment, "tenant-a", "branch-a", now), "expired");
  assert.equal(ticket.status, "issued");
});

test("gate accepts only confirmed, waiting, or in-progress appointments", () => {
  for (const status of ["confirmed", "waiting", "in_progress"] as const) {
    assert.equal(isDigitalTicketAppointmentEligible(status), true);
    const ticket: MemoryTicket = { id: `ticket-${status}`, tenantId: "tenant-a", branchId: "branch-a", status: "issued", expiresAt: new Date("2026-10-19T14:00:00.000Z") };
    assert.equal(digitalTicketFailure(ticket, { ...appointment, status }, "tenant-a", "branch-a", now), null);
  }
  for (const status of ["pending", "cancelled", "no_show", "completed"] as const) {
    assert.equal(isDigitalTicketAppointmentEligible(status), false);
    const ticket: MemoryTicket = { id: `ticket-${status}`, tenantId: "tenant-a", branchId: "branch-a", status: "issued", expiresAt: new Date("2026-10-19T14:00:00.000Z") };
    assert.equal(digitalTicketFailure(ticket, { ...appointment, status }, "tenant-a", "branch-a", now), "appointment");
    assert.equal(ticket.status, "issued");
  }
});

test("reschedule refreshes expiry from the new end and never resurrects a checked-in or revoked QR", () => {
  const newEndsAt = new Date("2026-10-22T13:30:00.000Z");
  assert.equal(digitalTicketExpiresAt(newEndsAt).toISOString(), "2026-10-22T14:00:00.000Z");

  const checkedIn: MemoryTicket = { id: "ticket-checked-in", tenantId: "tenant-a", branchId: "branch-a", status: "checked_in", expiresAt: digitalTicketExpiresAt(appointment.endsAt) };
  assert.equal(digitalTicketFailure(checkedIn, { ...appointment, startsAt: new Date("2026-10-22T12:30:00.000Z"), endsAt: newEndsAt }, "tenant-a", "branch-a", new Date("2026-10-22T13:00:00.000Z")), "replay");

  const revoked: MemoryTicket = { id: "ticket-revoked", tenantId: "tenant-a", branchId: "branch-a", status: "revoked", expiresAt: digitalTicketExpiresAt(appointment.endsAt) };
  assert.equal(digitalTicketFailure(revoked, { ...appointment, startsAt: new Date("2026-10-22T12:30:00.000Z"), endsAt: newEndsAt }, "tenant-a", "branch-a", new Date("2026-10-22T13:00:00.000Z")), "inactive");
});
