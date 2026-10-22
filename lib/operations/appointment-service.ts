import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { appointments, branches, customers, services, users } from "@/lib/db/schema";
import { ApiError, type OperationContext } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";

export interface AppointmentReferenceInput { branchId: string; customerId: string; serviceId: string; providerId: string | null; startsAt: Date; }

export async function validateAppointmentReferences(context: OperationContext, input: AppointmentReferenceInput, currentId?: string): Promise<{ end: Date; durationMinutes: number }> {
  const [branch] = await context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, context.tenantId), eq(branches.isActive, true))).limit(1);
  if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط", 404);
  const [customer] = await context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, context.tenantId))).limit(1);
  if (!customer) throw new ApiError("العميل غير موجود في مساحة العمل", 404);
  const serviceFilters = [eq(services.id, input.serviceId), eq(services.tenantId, context.tenantId)];
  if (!currentId) serviceFilters.push(eq(services.isActive, true));
  const [service] = await context.db.select({ id: services.id, durationMinutes: services.durationMinutes, branchId: services.branchId }).from(services).where(and(...serviceFilters)).limit(1);
  if (!service || (service.branchId && service.branchId !== input.branchId)) throw new ApiError("الخدمة غير متاحة في هذا الفرع", 404);
  if (input.providerId) {
    const [provider] = await context.db.select({ id: users.id }).from(users).where(and(eq(users.id, input.providerId), eq(users.tenantId, context.tenantId), inArray(users.role, ["provider", "doctor", "specialist"]), eq(users.isActive, true))).limit(1);
    if (!provider) throw new ApiError("مقدم الخدمة غير موجود في مساحة العمل", 404);
  }
  if (isClinicalRole(context.session.role) && input.providerId !== context.session.sub) throw new ApiError("يمكن لمقدم الخدمة إدارة مواعيده المخصصة فقط", 403);
  const end = new Date(input.startsAt.getTime() + service.durationMinutes * 60_000);
  const activeStatuses = ["pending", "confirmed", "waiting", "in_progress"] as const;
  if (input.providerId) {
    const conditions = [eq(appointments.tenantId, context.tenantId), eq(appointments.providerId, input.providerId), inArray(appointments.status, [...activeStatuses]), lt(appointments.startsAt, end), gt(appointments.endsAt, input.startsAt)];
    if (currentId) conditions.push(ne(appointments.id, currentId));
    const conflicts = await context.db.select({ id: appointments.id }).from(appointments).where(and(...conditions)).limit(1);
    if (conflicts.length) throw new ApiError("لدى مقدم الخدمة موعد آخر يتداخل مع هذه الفترة", 409);
  }
  return { end, durationMinutes: service.durationMinutes };
}
