export const DIGITAL_TICKET_EARLY_MINUTES = 60;
export const DIGITAL_TICKET_LATE_MINUTES = 30;

export function digitalTicketExpiresAt(endsAt: Date): Date {
  return new Date(endsAt.getTime() + DIGITAL_TICKET_LATE_MINUTES * 60_000);
}

export function isWithinDigitalTicketWindow(startsAt: Date, endsAt: Date, now = new Date()): boolean {
  return now.getTime() >= startsAt.getTime() - DIGITAL_TICKET_EARLY_MINUTES * 60_000 && now.getTime() <= endsAt.getTime() + DIGITAL_TICKET_LATE_MINUTES * 60_000;
}

export async function hashDigitalTicketToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A management link is the only bearer secret that can reopen a public pass.
 * Deriving the ticket token from it means D1 stores only a hash while the
 * holder can recreate the same QR after a reload; no raw ticket is put in a
 * URL or persisted server-side.
 */
export async function derivePublicDigitalTicketToken(manageToken: string, tenantId: string, appointmentId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qutoof:digital-ticket:${tenantId}:${appointmentId}:${manageToken}`));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export type DigitalTicketCheck = {
  tenantId: string;
  branchId: string | null;
  status: "issued" | "checked_in" | "revoked" | "expired";
  expiresAt: Date;
};

export type DigitalTicketAppointmentStatus = "pending" | "confirmed" | "waiting" | "in_progress" | "completed" | "no_show" | "cancelled";

export type DigitalTicketAppointment = {
  tenantId: string;
  branchId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: DigitalTicketAppointmentStatus;
};

export type DigitalTicketFailure = "tenant" | "branch" | "replay" | "inactive" | "appointment" | "expired" | "window";

export function isDigitalTicketAppointmentEligible(status: DigitalTicketAppointmentStatus): boolean {
  return status === "confirmed" || status === "waiting" || status === "in_progress";
}

export function digitalTicketFailure(ticket: DigitalTicketCheck, appointment: DigitalTicketAppointment, expectedTenantId: string, expectedBranchId: string | null, now = new Date()): DigitalTicketFailure | null {
  if (ticket.tenantId !== expectedTenantId || appointment.tenantId !== expectedTenantId) return "tenant";
  if (!expectedBranchId || ticket.branchId !== appointment.branchId || ticket.branchId !== expectedBranchId) return "branch";
  if (ticket.status === "checked_in") return "replay";
  if (ticket.status !== "issued") return "inactive";
  if (!isDigitalTicketAppointmentEligible(appointment.status)) return "appointment";
  if (now.getTime() > ticket.expiresAt.getTime()) return "expired";
  if (!isWithinDigitalTicketWindow(appointment.startsAt, appointment.endsAt, now)) return "window";
  return null;
}
