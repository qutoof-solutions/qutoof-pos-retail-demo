import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, eq } from "drizzle-orm";
import { appointments, digitalTickets } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { uuidSchema } from "@/lib/operations/validation";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { hashDigitalTicketToken } from "@/lib/operations/digital-tickets";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
function newToken() { return `${crypto.randomUUID()}-${crypto.randomUUID()}`; }

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.invalidAppointmentId"));
    const { db, tenantId, session } = access.context;
    const [appointment] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId))).limit(1);
    if (!appointment) throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.notFound"), 404);
    await requireBranchMembership(access.context, appointment.branchId);
    if (isClinicalRole(session.role) && appointment.providerId !== session.sub) throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.notAssigned"), 403);
    if (!["pending", "confirmed", "waiting", "in_progress"].includes(appointment.status)) throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.invalidStatus"), 409);
    const [existing] = await db.select().from(digitalTickets).where(and(eq(digitalTickets.tenantId, tenantId), eq(digitalTickets.appointmentId, id))).limit(1);
    if (existing?.status === "checked_in") throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.alreadyUsed"), 409);
    if (existing?.status === "issued") throw new ApiError(serverMessage(request, "p1Server.appointmentTicket.activeTicket"), 409);
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(appointment.endsAt.getTime() + 30 * 60_000);
    const ticketId = existing?.id ?? crypto.randomUUID();
    const [ticket] = existing
      ? await db.update(digitalTickets).set({ tokenHash: await hashDigitalTicketToken(token), status: "issued", issuedAt: now, expiresAt, checkedInAt: null, checkedInBy: null, checkInMethod: null }).where(and(eq(digitalTickets.id, ticketId), eq(digitalTickets.tenantId, tenantId))).returning()
      : await db.insert(digitalTickets).values({ id: ticketId, tenantId, appointmentId: id, branchId: appointment.branchId, tokenHash: await hashDigitalTicketToken(token), status: "issued", issuedAt: now, expiresAt }).returning();
    await writeAudit(access.context, request, "digital_ticket.issued", "digital_ticket", ticket.id, { appointmentId: id, expiresAt: expiresAt.toISOString() });
    return Response.json({ ticket: { id: ticket.id, token, qrPayload: token, appointmentId: id, status: ticket.status, startsAt: appointment.startsAt, endsAt: appointment.endsAt, expiresAt: ticket.expiresAt }, printable: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
