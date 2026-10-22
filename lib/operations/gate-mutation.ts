import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { appointments } from "@/lib/db/schema";
import type { DigitalTicketAppointmentStatus } from "@/lib/operations/digital-tickets";

export const gateEligibleAppointmentStatuses = ["confirmed", "waiting", "in_progress"] as const;
export type GateAppointmentSnapshot = {
  tenantId: string;
  id: string;
  branchId: string | null;
  status: DigitalTicketAppointmentStatus;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Correlates a mutation with the appointment row that the gate candidate read.
 * The predicate deliberately includes every value used to validate the QR so a
 * cancel/reschedule between SELECT and UPDATE cannot leave a stale QR usable.
 */
export function currentAppointmentExists(candidate: GateAppointmentSnapshot, eligibleOnly = false): SQL {
  const branchPredicate = candidate.branchId === null
    ? isNull(appointments.branchId)
    : eq(appointments.branchId, candidate.branchId);
  return sql`EXISTS (SELECT 1 FROM ${appointments} WHERE ${and(
    eq(appointments.tenantId, candidate.tenantId),
    eq(appointments.id, candidate.id),
    branchPredicate,
    ...(eligibleOnly ? [inArray(appointments.status, gateEligibleAppointmentStatuses)] : []),
    eq(appointments.status, candidate.status),
    eq(appointments.startsAt, candidate.startsAt),
    eq(appointments.endsAt, candidate.endsAt),
  )})`;
}

export function currentGateAppointmentExists(candidate: GateAppointmentSnapshot): SQL {
  return currentAppointmentExists(candidate, true);
}

/**
 * D1 batches are atomic when a statement errors, but a zero-row UPDATE is not
 * an error. This assertion turns a failed changes() hand-off into a SQLite
 * error so the enclosing batch rolls back instead of leaving half a mutation.
 */
export function assertPreviousMutationChanged(): SQL {
  return sql`SELECT CASE WHEN changes() = 0 THEN json('{') ELSE 1 END`;
}
