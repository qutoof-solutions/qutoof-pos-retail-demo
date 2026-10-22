import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, whatsappNotifications } from "@/lib/db/schema";
import { appointmentPatchSchema } from "@/lib/operations/appointment-validation";
import { checkSlotAvailability } from "@/lib/operations/scheduling";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { validateAppointmentReferences } from "@/lib/operations/appointment-service";
import { cancelPendingAppointmentNotifications, dispatchOneWhatsAppNotification, queueReviewIfCompleted, rescheduleBookingNotifications } from "@/services/whatsapp";
import { getRuntimeEnv } from "@/lib/db/client";
import { isClinicalRole } from "@/lib/operations/permissions";
import { buildServiceConsumptionStatements } from "@/lib/operations/service-consumption";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const nextStates: Record<string, readonly string[]> = { pending: ["confirmed", "cancelled", "no_show"], confirmed: ["waiting", "in_progress", "completed", "cancelled", "no_show"], waiting: ["in_progress", "cancelled", "no_show"], in_progress: ["completed", "cancelled"], completed: [], no_show: [], cancelled: [] };

export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError("معرف الموعد غير صالح");
    const parsed = appointmentPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات تعديل الموعد غير صالحة");
    const input = parsed.data;
    if (isClinicalRole(access.context.session.role) && Object.keys(input).some((key) => key !== "status")) throw new ApiError("يمكن للطبيب تحديث حالة موعده المسند فقط", 403);
    if (input.status === "cancelled" && !input.cancellationReason?.trim()) throw new ApiError("اكتب سبب إلغاء الموعد");
    const [current] = await access.context.db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, access.context.tenantId))).limit(1);
    if (!current) throw new ApiError("الموعد غير موجود", 404);
    await requireBranchMembership(access.context, current.branchId);
    if (isClinicalRole(access.context.session.role) && current.providerId !== access.context.session.sub) throw new ApiError("يمكن للطبيب إدارة مواعيده المسندة فقط", 403);
    if (input.status && input.status !== current.status) {
      if (!nextStates[current.status]?.includes(input.status)) throw new ApiError("انتقال حالة الموعد غير مسموح");
      if (isClinicalRole(access.context.session.role) && !((current.status === "waiting" && input.status === "in_progress") || (current.status === "in_progress" && input.status === "completed"))) throw new ApiError("لا يسمح للطبيب بهذا التغيير في الحالة", 403);
    }
    const branchId = input.branchId ?? current.branchId;
    if (!branchId) throw new ApiError("يجب تعيين الموعد إلى فرع");
    if (input.branchId && input.branchId !== current.branchId) await requireBranchMembership(access.context, input.branchId);
    const values = {
      customerId: input.customerId ?? current.customerId,
      serviceId: input.serviceId ?? current.serviceId,
      branchId,
      providerId: input.providerId === undefined ? current.providerId : input.providerId,
      startsAt: input.startsAt ?? current.startsAt,
    };
    const refs = await validateAppointmentReferences(access.context, values, id);
    const activeStatuses = ["pending", "confirmed", "waiting", "in_progress"];
    const changedSlot = input.startsAt !== undefined || input.serviceId !== undefined || input.branchId !== undefined || input.providerId !== undefined || (input.status !== undefined && activeStatuses.includes(input.status) && !activeStatuses.includes(current.status));
    if (changedSlot) {
      const availability = await checkSlotAvailability(access.context, { branchId: values.branchId, providerId: values.providerId, start: values.startsAt, end: refs.end });
      if (!availability.ok) throw new ApiError(availability.reason, 409);
    }
    const updatedValues = { ...values, endsAt: refs.end, status: input.status ?? current.status, notes: input.notes === undefined ? current.notes : input.notes, cancellationReason: input.cancellationReason === undefined ? current.cancellationReason : input.cancellationReason, updatedAt: new Date() };
    let updated = undefined as typeof current | undefined;
    if (input.status === "completed" && current.status !== "completed") {
      const d1 = access.context.env.DB;
      const now = Math.floor(Date.now() / 1000);
      const appointmentUpdate = d1.prepare("UPDATE appointments SET customer_id = ?, service_id = ?, branch_id = ?, provider_id = ?, starts_at = ?, ends_at = ?, status = 'completed', notes = ?, cancellation_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = ?")
        .bind(updatedValues.customerId, updatedValues.serviceId, updatedValues.branchId, updatedValues.providerId, updatedValues.startsAt.getTime() / 1000, updatedValues.endsAt.getTime() / 1000, updatedValues.notes, updatedValues.cancellationReason, now, id, access.context.tenantId, current.status);
      const materialStatements = await buildServiceConsumptionStatements(d1, { tenantId: access.context.tenantId, appointmentId: id, serviceId: values.serviceId, branchId: values.branchId, userId: access.context.user.id, now });
      await d1.batch([appointmentUpdate, ...materialStatements]);
      [updated] = await access.context.db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, access.context.tenantId))).limit(1);
    } else {
      [updated] = await access.context.db.update(appointments).set(updatedValues).where(and(eq(appointments.id, id), eq(appointments.tenantId, access.context.tenantId))).returning();
    }
    if (!updated) throw new ApiError("تعذر تحديث الموعد", 409);
    await writeAudit(access.context, request, "appointment.updated", "appointment", id, { from: current.status, to: updated?.status });
    let notificationWarning: string | null = null;
    try {
      if (input.status === "cancelled") await cancelPendingAppointmentNotifications(access.context.db, access.context.tenantId, id);
      if (input.status === "completed") await queueReviewIfCompleted(access.context.db, { tenantId: access.context.tenantId, appointmentId: id });
      const rescheduled = input.startsAt !== undefined || input.serviceId !== undefined || input.branchId !== undefined || input.providerId !== undefined;
      if (rescheduled && current.source === "public_portal" && current.whatsappOptIn) {
        const [customer] = await access.context.db.select({ phone: customers.phone }).from(customers).where(and(eq(customers.id, current.customerId), eq(customers.tenantId, access.context.tenantId))).limit(1);
        if (customer) {
          await rescheduleBookingNotifications(access.context.db, { tenantId: access.context.tenantId, appointmentId: id, customerPhone: customer.phone, startsAt: values.startsAt, endsAt: refs.end });
          const dedupeKey = `${id}:reschedule:${values.startsAt.getTime()}`;
          const [confirmation] = await access.context.db.select({ id: whatsappNotifications.id }).from(whatsappNotifications).where(and(eq(whatsappNotifications.tenantId, access.context.tenantId), eq(whatsappNotifications.dedupeKey, dedupeKey))).limit(1);
          if (confirmation) await dispatchOneWhatsAppNotification(access.context.db, getRuntimeEnv(), confirmation.id);
        }
      }
    } catch { notificationWarning = "تم حفظ الموعد لكن تعذر تحديث إشعار WhatsApp؛ راجع اتصال WhatsApp."; }
    return Response.json({ appointment: updated, notificationWarning });
  } catch (error) {
    if (String(error).includes("APPOINTMENT_PROVIDER_OVERLAP")) return Response.json({ error: "لدى مقدم الخدمة موعد آخر يتداخل مع هذه الفترة" }, { status: 409 });
    return errorResponse(error);
  }
}
