import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appointments, branches, customers, queueTickets } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/operations/validation";
import { isClinicalRole } from "@/lib/operations/permissions";
import { buildServiceConsumptionStatements } from "@/lib/operations/service-consumption";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), branchId: uuidSchema, appointmentId: uuidSchema }),
  z.object({ action: z.literal("call_next"), branchId: uuidSchema }),
  z.object({ action: z.literal("start"), branchId: uuidSchema, ticketId: uuidSchema }),
  z.object({ action: z.literal("complete"), branchId: uuidSchema, ticketId: uuidSchema }),
  z.object({ action: z.literal("skip"), branchId: uuidSchema, ticketId: uuidSchema }),
]);

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId || !uuidSchema.safeParse(branchId).success) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  await requireBranchMembership(access.context, branchId);
  const rows = await access.context.db.select({ id: queueTickets.id, ticketNumber: queueTickets.ticketNumber, displayLabel: queueTickets.displayLabel, status: queueTickets.status, appointmentId: queueTickets.appointmentId, customerName: customers.fullName, issuedAt: queueTickets.issuedAt, calledAt: queueTickets.calledAt })
    .from(queueTickets)
    .leftJoin(appointments, and(eq(appointments.id, queueTickets.appointmentId), eq(appointments.tenantId, access.context.tenantId)))
    .leftJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, access.context.tenantId)))
    .where(and(eq(queueTickets.tenantId, access.context.tenantId), eq(queueTickets.branchId, branchId), inArray(queueTickets.status, ["waiting", "called", "serving"]), ...(isClinicalRole(access.context.session.role) ? [eq(appointments.providerId, access.context.session.sub)] : [])))
    .orderBy(asc(queueTickets.issuedAt));
  return Response.json({ tickets: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات إجراء قائمة الانتظار غير صحيحة");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const clinical = isClinicalRole(access.context.session.role);
    if (clinical && input.action !== "start" && input.action !== "complete") throw new ApiError("يمكن للطبيب بدء أو إنهاء تذاكر مواعيده المسندة فقط", 403);
    const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود", 404);
    const d1 = access.context.env.DB;

    if (input.action === "issue") {
      const [appointment] = await access.context.db.select({ id: appointments.id, status: appointments.status }).from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, access.context.tenantId), eq(appointments.branchId, input.branchId))).limit(1);
      if (!appointment || !["pending", "confirmed", "waiting"].includes(appointment.status)) throw new ApiError("الموعد غير مؤهل لإصدار تذكرة انتظار", 409);
      const [existingTicket] = await access.context.db.select({ id: queueTickets.id }).from(queueTickets).where(and(eq(queueTickets.tenantId, access.context.tenantId), eq(queueTickets.appointmentId, input.appointmentId))).limit(1);
      if (existingTicket) throw new ApiError("سبق إصدار تذكرة انتظار لهذا الموعد", 409);

      const id = crypto.randomUUID();
      await d1.batch([
        d1.prepare("UPDATE appointments SET status = 'waiting', updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND branch_id = ? AND status IN ('pending', 'confirmed', 'waiting') AND NOT EXISTS (SELECT 1 FROM queue_tickets WHERE tenant_id = ? AND appointment_id = ?)")
          .bind(input.appointmentId, access.context.tenantId, input.branchId, access.context.tenantId, input.appointmentId),
        d1.prepare("WITH next_ticket AS (SELECT COALESCE(MAX(ticket_number), 0) + 1 AS n FROM queue_tickets WHERE tenant_id = ? AND branch_id = ?) INSERT INTO queue_tickets (id, tenant_id, branch_id, appointment_id, ticket_number, display_label, status, created_at) SELECT ?, ?, ?, a.id, next_ticket.n, 'الدور ' || next_ticket.n, 'waiting', unixepoch() FROM appointments a, next_ticket WHERE a.id = ? AND a.tenant_id = ? AND a.branch_id = ? AND a.status = 'waiting' AND NOT EXISTS (SELECT 1 FROM queue_tickets WHERE tenant_id = ? AND appointment_id = ?)")
          .bind(access.context.tenantId, input.branchId, id, access.context.tenantId, input.branchId, input.appointmentId, access.context.tenantId, input.branchId, access.context.tenantId, input.appointmentId),
      ]);
      const [ticket] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, id), eq(queueTickets.tenantId, access.context.tenantId))).limit(1);
      if (!ticket) throw new ApiError("تغيرت حالة الموعد أثناء إصدار التذكرة؛ حدّث الشاشة", 409);
      await writeAudit(access.context, request, "queue.ticket_issued", "queue_ticket", id, { ticketNumber: ticket.ticketNumber, branchId: input.branchId });
      return Response.json({ ticket }, { status: 201 });
    }

    if (input.action === "call_next") {
      const results = await d1.batch([
        d1.prepare("UPDATE queue_tickets SET status = 'called', called_at = unixepoch() WHERE id = (SELECT candidate.id FROM queue_tickets candidate WHERE candidate.tenant_id = ? AND candidate.branch_id = ? AND candidate.status = 'waiting' AND NOT EXISTS (SELECT 1 FROM queue_tickets active WHERE active.tenant_id = ? AND active.branch_id = ? AND active.status IN ('called', 'serving')) ORDER BY candidate.created_at, candidate.id LIMIT 1) AND tenant_id = ? AND branch_id = ? AND status = 'waiting' AND NOT EXISTS (SELECT 1 FROM queue_tickets active WHERE active.tenant_id = ? AND active.branch_id = ? AND active.status IN ('called', 'serving'))")
          .bind(access.context.tenantId, input.branchId, access.context.tenantId, input.branchId, access.context.tenantId, input.branchId, access.context.tenantId, input.branchId),
        d1.prepare("SELECT id FROM queue_tickets WHERE tenant_id = ? AND branch_id = ? AND status = 'called' ORDER BY called_at DESC, id LIMIT 1")
          .bind(access.context.tenantId, input.branchId),
      ]);
      if (!results[0]?.meta.changes) {
        const [active] = await access.context.db.select({ id: queueTickets.id }).from(queueTickets).where(and(eq(queueTickets.tenantId, access.context.tenantId), eq(queueTickets.branchId, input.branchId), inArray(queueTickets.status, ["called", "serving"]))).limit(1);
        if (active) throw new ApiError("أنه الإجراء الحالي قبل نداء الدور التالي", 409);
        throw new ApiError("لا يوجد عميل في الانتظار", 404);
      }
      const ticketId = (results[1]?.results?.[0] as { id?: string } | undefined)?.id;
      if (!ticketId) throw new ApiError("تعذر قراءة تذكرة الدور بعد ندائها", 409);
      const [called] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, ticketId), eq(queueTickets.tenantId, access.context.tenantId))).limit(1);
      if (!called) throw new ApiError("تغيرت حالة قائمة الانتظار؛ حدّث الشاشة", 409);
      await writeAudit(access.context, request, "queue.ticket_called", "queue_ticket", called.id, { ticketNumber: called.ticketNumber });
      return Response.json({ ticket: called });
    }

    const [ticket] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, input.ticketId), eq(queueTickets.tenantId, access.context.tenantId), eq(queueTickets.branchId, input.branchId))).limit(1);
    if (!ticket) throw new ApiError("تذكرة الانتظار غير موجودة", 404);
    if (clinical) {
      if (!ticket.appointmentId) throw new ApiError("لا يمكن للطبيب إدارة دور غير مرتبط بموعد مسند", 403);
      const [assignedAppointment] = await access.context.db.select({ providerId: appointments.providerId }).from(appointments).where(and(eq(appointments.id, ticket.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
      if (!assignedAppointment || assignedAppointment.providerId !== access.context.session.sub) throw new ApiError("تذكرة الانتظار ليست لموعد مسند إليك", 403);
    }

    if (input.action === "start") {
      if (ticket.status !== "called") throw new ApiError("يجب نداء التذكرة أولاً", 409);
      const startTicket = d1.prepare("UPDATE queue_tickets SET status = 'serving' WHERE id = ? AND tenant_id = ? AND branch_id = ? AND status = 'called' AND (appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = queue_tickets.appointment_id AND a.tenant_id = queue_tickets.tenant_id AND a.status IN ('pending', 'confirmed', 'waiting', 'in_progress') AND (a.branch_id IS NULL OR a.branch_id = queue_tickets.branch_id)))")
        .bind(ticket.id, access.context.tenantId, input.branchId);
      const statements: D1PreparedStatement[] = [startTicket];
      if (ticket.appointmentId) {
        statements.push(d1.prepare("UPDATE appointments SET status = 'in_progress', updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'confirmed', 'waiting', 'in_progress') AND EXISTS (SELECT 1 FROM queue_tickets q WHERE q.id = ? AND q.tenant_id = ? AND q.status = 'serving')")
          .bind(ticket.appointmentId, access.context.tenantId, ticket.id, access.context.tenantId));
      }
      await d1.batch(statements);
      const [updated] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, ticket.id), eq(queueTickets.tenantId, access.context.tenantId))).limit(1);
      if (updated?.status !== "serving") throw new ApiError("تغيرت حالة الدور أو الموعد؛ حدّث الشاشة", 409);
      if (ticket.appointmentId) {
        const [updatedAppointment] = await access.context.db.select({ status: appointments.status }).from(appointments).where(and(eq(appointments.id, ticket.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
        if (updatedAppointment?.status !== "in_progress") throw new ApiError("تعذر بدء الموعد مع التذكرة؛ حدّث الشاشة", 409);
      }
      await writeAudit(access.context, request, "queue.service_started", "queue_ticket", ticket.id);
      return Response.json({ ticket: updated });
    }

    if (input.action === "complete") {
      if (ticket.status === "completed") return Response.json({ ticket, replayed: true }, { headers: { "Cache-Control": "no-store" } });
      if (ticket.status !== "called" && ticket.status !== "serving") throw new ApiError("التذكرة ليست قيد النداء أو الخدمة", 409);
      if (clinical && ticket.status !== "serving") throw new ApiError("ابدأ خدمة موعدك قبل إنهاء الدور", 409);
      const statements: D1PreparedStatement[] = [d1.prepare("UPDATE queue_tickets SET status = 'completed', completed_at = unixepoch() WHERE id = ? AND tenant_id = ? AND branch_id = ? AND status IN ('called', 'serving') AND (appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = queue_tickets.appointment_id AND a.tenant_id = queue_tickets.tenant_id AND a.status IN ('pending', 'confirmed', 'waiting', 'in_progress', 'completed') AND (a.branch_id IS NULL OR a.branch_id = queue_tickets.branch_id)))")
        .bind(ticket.id, access.context.tenantId, input.branchId)];
      let appointmentStatus: string | null = null;
      if (ticket.appointmentId) {
        const [appointment] = await access.context.db.select({ id: appointments.id, serviceId: appointments.serviceId, branchId: appointments.branchId, status: appointments.status }).from(appointments).where(and(eq(appointments.id, ticket.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
        if (!appointment) throw new ApiError("موعد تذكرة الانتظار غير موجود", 404);
        if (appointment.branchId && appointment.branchId !== input.branchId) throw new ApiError("فرع تذكرة الانتظار لا يطابق فرع الموعد", 409);
        appointmentStatus = appointment.status;
        if (appointment.status !== "completed") {
          if (!["pending", "confirmed", "waiting", "in_progress"].includes(appointment.status)) throw new ApiError("حالة الموعد لا تسمح بإكمال الخدمة من الانتظار", 409);
          statements.push(d1.prepare("UPDATE appointments SET status = 'completed', updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND status = ? AND status IN ('pending', 'confirmed', 'waiting', 'in_progress') AND EXISTS (SELECT 1 FROM queue_tickets q WHERE q.id = ? AND q.tenant_id = ? AND q.status = 'completed')")
            .bind(appointment.id, access.context.tenantId, appointment.status, ticket.id, access.context.tenantId));
          const materialStatements = await buildServiceConsumptionStatements(d1, { tenantId: access.context.tenantId, appointmentId: appointment.id, serviceId: appointment.serviceId, branchId: input.branchId, userId: access.context.user.id, now: Math.floor(Date.now() / 1000), queueTicketId: ticket.id });
          statements.push(...materialStatements);
        }
      }
      await d1.batch(statements);
      const [latest] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, ticket.id), eq(queueTickets.tenantId, access.context.tenantId))).limit(1);
      if (latest?.status !== "completed") throw new ApiError("تغيرت حالة الدور؛ حدّث الشاشة", 409);
      if (ticket.appointmentId) {
        const [afterComplete] = await access.context.db.select({ status: appointments.status }).from(appointments).where(and(eq(appointments.id, ticket.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
        if (afterComplete?.status !== "completed") throw new ApiError("تعذر إكمال الموعد مع تذكرة الانتظار", 409);
      }
      await writeAudit(access.context, request, "queue.ticket_completed", "queue_ticket", ticket.id, appointmentStatus === "completed" ? { replayedAppointment: true } : undefined);
      return Response.json({ ticket: latest });
    }

    if (ticket.status !== "called") throw new ApiError("لا يمكن تخطي الدور بعد بدء الخدمة؛ أنه الخدمة أو ألغها من الموعد", 409);
    const statements: D1PreparedStatement[] = [d1.prepare("UPDATE queue_tickets SET status = 'skipped', completed_at = unixepoch() WHERE id = ? AND tenant_id = ? AND branch_id = ? AND status = 'called' AND (appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = queue_tickets.appointment_id AND a.tenant_id = queue_tickets.tenant_id AND a.status IN ('pending', 'confirmed', 'waiting') AND (a.branch_id IS NULL OR a.branch_id = queue_tickets.branch_id)))")
      .bind(ticket.id, access.context.tenantId, input.branchId)];
    if (ticket.appointmentId) {
      statements.push(d1.prepare("UPDATE appointments SET status = 'no_show', updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'confirmed', 'waiting') AND EXISTS (SELECT 1 FROM queue_tickets q WHERE q.id = ? AND q.tenant_id = ? AND q.status = 'skipped')")
        .bind(ticket.appointmentId, access.context.tenantId, ticket.id, access.context.tenantId));
    }
    await d1.batch(statements);
    const [updated] = await access.context.db.select().from(queueTickets).where(and(eq(queueTickets.id, ticket.id), eq(queueTickets.tenantId, access.context.tenantId))).limit(1);
    if (updated?.status !== "skipped") throw new ApiError("تغيرت حالة الدور أو الموعد؛ حدّث الشاشة", 409);
    if (ticket.appointmentId) {
      const [afterSkip] = await access.context.db.select({ status: appointments.status }).from(appointments).where(and(eq(appointments.id, ticket.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
      if (afterSkip?.status !== "no_show") throw new ApiError("تعذر تحديث الموعد عند تخطي الدور", 409);
    }
    await writeAudit(access.context, request, "queue.ticket_skipped", "queue_ticket", ticket.id);
    return Response.json({ ticket: updated });
  } catch (error) {
    if (String(error).includes("queue_ticket_appointment_uq")) return Response.json({ error: "سبق إصدار تذكرة انتظار لهذا الموعد" }, { status: 409 });
    if (String(error).includes("queue_ticket_branch_number_uq")) return Response.json({ error: "تعذر تخصيص رقم الدور؛ حدّث الشاشة وأعد المحاولة" }, { status: 409 });
    if (String(error).includes("queue_one_active_ticket_uq")) return Response.json({ error: "يوجد دور نشط بالفعل؛ حدّث شاشة الانتظار" }, { status: 409 });
    return errorResponse(error);
  }
}
