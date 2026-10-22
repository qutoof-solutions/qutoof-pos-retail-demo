import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, services, users } from "@/lib/db/schema";
import { appointmentCreateSchema } from "@/lib/operations/appointment-validation";
import { checkSlotAvailability } from "@/lib/operations/scheduling";
import { validateAppointmentReferences } from "@/lib/operations/appointment-service";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request);
  if (!access.ok) return access.response;
  const url = new URL(request.url);
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  const from = fromValue ? new Date(fromValue) : new Date(Date.now() - 7 * 86_400_000);
  const to = toValue ? new Date(toValue) : new Date(Date.now() + 7 * 86_400_000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 32 * 86_400_000) return Response.json({ error: "فترة التقويم غير صالحة؛ الحد الأقصى ٣٢ يوماً" }, { status: 400 });
  const filters = [eq(appointments.tenantId, access.context.tenantId), gte(appointments.startsAt, from), lt(appointments.startsAt, to)];
  const branchId = url.searchParams.get("branchId");
  const accessibleBranchIds = await getAccessibleBranchIds(access.context);
  if (branchId) {
    if (!z.string().uuid().safeParse(branchId).success) return Response.json({ error: "معرف الفرع غير صالح" }, { status: 400 });
    await requireBranchMembership(access.context, branchId);
    filters.push(eq(appointments.branchId, branchId));
  } else {
    if (!accessibleBranchIds.length) return Response.json({ appointments: [] }, { headers: { "Cache-Control": "no-store" } });
    filters.push(inArray(appointments.branchId, accessibleBranchIds));
  }
  if (isClinicalRole(access.context.session.role)) filters.push(eq(appointments.providerId, access.context.session.sub));
  const rows = await access.context.db.select({ id: appointments.id, tenantId: appointments.tenantId, branchId: appointments.branchId, customerId: appointments.customerId, customerName: customers.fullName, customerPhone: customers.phone, serviceId: appointments.serviceId, serviceName: services.name, providerId: appointments.providerId, providerName: users.fullName, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, notes: appointments.notes, cancellationReason: appointments.cancellationReason, customerResponse: appointments.customerResponse })
    .from(appointments)
    .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, access.context.tenantId)))
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, access.context.tenantId)))
    .leftJoin(users, and(eq(users.id, appointments.providerId), eq(users.tenantId, access.context.tenantId)))
    .where(and(...filters)).orderBy(asc(appointments.startsAt));
  return Response.json({ appointments: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = appointmentCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات الموعد");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const now = Date.now();
    if (input.startsAt.getTime() < now - 5 * 60_000 || input.startsAt.getTime() > now + 366 * 86_400_000) throw new ApiError("يجب أن يكون الموعد خلال السنة القادمة");
    const { end } = await validateAppointmentReferences(access.context, input);
    let visitType: "new" | "follow_up" = "new";
    let followUpOfAppointmentId: string | null = null;
    let followUpEligible = false;
    try {
      const settings = JSON.parse(access.context.tenant.settingsJson || "{}") as { medical?: { followUpDays?: number } };
      const followUpDays = Math.min(90, Math.max(0, Number(settings.medical?.followUpDays ?? 14)));
      if (followUpDays > 0) {
        const [previous] = await access.context.db.select({ id: appointments.id }).from(appointments)
          .where(and(eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, input.customerId), eq(appointments.serviceId, input.serviceId), eq(appointments.status, "completed"), gte(appointments.startsAt, new Date(input.startsAt.getTime() - followUpDays * 86_400_000)), lt(appointments.startsAt, input.startsAt)))
          .orderBy(desc(appointments.startsAt)).limit(1);
        if (previous) { visitType = "follow_up"; followUpOfAppointmentId = previous.id; followUpEligible = true; }
      }
    } catch { /* legacy or malformed settings use the default new-visit behavior */ }
    const availability = await checkSlotAvailability(access.context, { branchId: input.branchId, providerId: input.providerId, start: input.startsAt, end });
    if (!availability.ok) throw new ApiError(availability.reason, 409);
    const id = crypto.randomUUID();
    const notes = followUpEligible ? `${input.notes ? `${input.notes} · ` : ""}إعادة مجانية خلال فترة الاستشارة` : input.notes ?? null;
    const [created] = await access.context.db.insert(appointments).values({ id, tenantId: access.context.tenantId, branchId: input.branchId, customerId: input.customerId, serviceId: input.serviceId, providerId: input.providerId, startsAt: input.startsAt, endsAt: end, status: input.status, source: "dashboard", notes, visitType, followUpOfAppointmentId, followUpEligible, createdBy: access.context.user.id, createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, "appointment.created", "appointment", id, { providerId: input.providerId, startsAt: input.startsAt.toISOString(), visitType, followUpOfAppointmentId });
    return Response.json({ appointment: created, followUp: { eligible: followUpEligible, appointmentId: followUpOfAppointmentId, patientDueMinor: followUpEligible ? 0 : null } }, { status: 201 });
  } catch (error) {
    if (String(error).includes("APPOINTMENT_PROVIDER_OVERLAP")) return Response.json({ error: "لدى مقدم الخدمة موعد آخر يتداخل مع هذه الفترة" }, { status: 409 });
    return errorResponse(error);
  }
}
