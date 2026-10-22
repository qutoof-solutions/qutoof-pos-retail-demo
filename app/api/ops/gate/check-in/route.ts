import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, digitalTickets, services } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { digitalTicketFailure, hashDigitalTicketToken } from "@/lib/operations/digital-tickets";
import { currentGateAppointmentExists } from "@/lib/operations/gate-mutation";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const inputSchema = z.object({ token: z.string().trim().min(20).max(200), method: z.enum(["qr", "manual"]).default("manual") });
export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(serverMessage(request, "p1Server.gate.invalidTicketCode"));
    const { db, tenantId, user } = access.context;
    const now = new Date();
    const tokenHash = await hashDigitalTicketToken(parsed.data.token);
    const [candidate] = await db.select({ ticket: digitalTickets, appointment: appointments, customerName: customers.fullName, serviceName: services.name }).from(digitalTickets)
      .innerJoin(appointments, and(eq(appointments.id, digitalTickets.appointmentId), eq(appointments.tenantId, tenantId)))
      .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, tenantId)))
      .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, tenantId)))
      .where(and(eq(digitalTickets.tenantId, tenantId), eq(digitalTickets.tokenHash, tokenHash))).limit(1);
    if (!candidate) throw new ApiError(serverMessage(request, "p1Server.gate.notFound"), 404);
    const { ticket, appointment } = candidate;
    await requireBranchMembership(access.context, appointment.branchId);
    const failure = digitalTicketFailure(ticket, appointment, tenantId, appointment.branchId, now);
    const currentAppointment = currentGateAppointmentExists({
      tenantId,
      id: appointment.id,
      branchId: appointment.branchId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    });
    if (failure === "replay") throw new ApiError(serverMessage(request, "p1Server.gate.alreadyUsed"), 409);
    if (failure === "branch" || failure === "tenant") throw new ApiError(serverMessage(request, "p1Server.gate.branchMismatch"), 403);
    if (failure === "inactive") throw new ApiError(serverMessage(request, "p1Server.gate.inactive"), 409);
    if (failure === "appointment") throw new ApiError(serverMessage(request, "p1Server.gate.appointmentNotEligible"), 409);
    if (failure === "expired") {
      await db.update(digitalTickets).set({ status: "expired" }).where(and(eq(digitalTickets.id, ticket.id), eq(digitalTickets.tenantId, tenantId), eq(digitalTickets.appointmentId, appointment.id), eq(digitalTickets.status, "issued"), eq(digitalTickets.expiresAt, ticket.expiresAt), currentAppointment)).run();
      throw new ApiError(serverMessage(request, "p1Server.gate.expired"), 409);
    }
    if (failure === "window") throw new ApiError(serverMessage(request, "p1Server.gate.outsideWindow"), 409);
    const [updated] = await db.update(digitalTickets).set({ status: "checked_in", checkedInAt: now, checkedInBy: user.id, checkInMethod: parsed.data.method }).where(and(eq(digitalTickets.id, ticket.id), eq(digitalTickets.tenantId, tenantId), eq(digitalTickets.appointmentId, appointment.id), eq(digitalTickets.status, "issued"), eq(digitalTickets.expiresAt, ticket.expiresAt), currentAppointment)).returning();
    if (!updated) throw new ApiError(serverMessage(request, "p1Server.gate.concurrentUse"), 409);
    await writeAudit(access.context, request, "digital_ticket.checked_in", "digital_ticket", ticket.id, { appointmentId: appointment.id, method: parsed.data.method });
    return Response.json({ accepted: true, checkIn: { ticketId: ticket.id, appointmentId: appointment.id, customerName: candidate.customerName, serviceName: candidate.serviceName, startsAt: appointment.startsAt, endsAt: appointment.endsAt, checkedInAt: updated.checkedInAt } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
