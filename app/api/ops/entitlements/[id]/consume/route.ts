import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appointments, customerEntitlementUsages, customerEntitlements, invoiceItems, invoices } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const inputSchema = z.object({ appointmentId: z.string().uuid() });

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: entitlementId } = await route.params;
    if (!z.string().uuid().safeParse(entitlementId).success) throw new ApiError("معرف الباقة غير صالح");
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("يجب ربط استهلاك الجلسة بموعد");
    const [entitlement] = await access.context.db.select().from(customerEntitlements).where(and(eq(customerEntitlements.id, entitlementId), eq(customerEntitlements.tenantId, access.context.tenantId))).limit(1);
    if (!entitlement) throw new ApiError("رصيد الباقة غير موجود", 404);
    const [sourceInvoice] = await access.context.db.select({ branchId: invoices.branchId }).from(invoiceItems).innerJoin(invoices, and(eq(invoices.id, invoiceItems.invoiceId), eq(invoices.tenantId, access.context.tenantId))).where(and(eq(invoiceItems.id, entitlement.invoiceItemId), eq(invoiceItems.tenantId, access.context.tenantId))).limit(1);
    if (!sourceInvoice) throw new ApiError("فاتورة الباقة غير موجودة", 409);
    await requireBranchMembership(access.context, sourceInvoice.branchId);
    if (entitlement.status !== "active" || entitlement.usedSessions >= entitlement.totalSessions) throw new ApiError("لا توجد جلسات متاحة في هذه الباقة", 409);
    if (entitlement.validUntil && entitlement.validUntil.getTime() < Date.now()) throw new ApiError("انتهت صلاحية الباقة", 409);
    const [appointment] = await access.context.db.select().from(appointments).where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, entitlement.customerId), eq(appointments.serviceId, entitlement.serviceId), inArray(appointments.status, ["waiting", "in_progress", "completed"]))).limit(1);
    if (!appointment) throw new ApiError("الزيارة لا تخص العميل أو الخدمة في هذه الباقة", 409);
    await requireBranchMembership(access.context, appointment.branchId);
    if (isClinicalRole(access.context.session.role) && appointment.providerId !== access.context.user.id) throw new ApiError("لا يمكنك استهلاك رصيد زيارة غير مخصصة لك", 403);
    const usageId = crypto.randomUUID();
    await access.context.db.insert(customerEntitlementUsages).values({ id: usageId, tenantId: access.context.tenantId, entitlementId, appointmentId: appointment.id, usedBy: access.context.user.id, usedAt: new Date() }).run();
    const [updated] = await access.context.db.select().from(customerEntitlements).where(and(eq(customerEntitlements.id, entitlementId), eq(customerEntitlements.tenantId, access.context.tenantId))).limit(1);
    await writeAudit(access.context, request, "customer_entitlement.session_used", "customer_entitlement", entitlementId, { appointmentId: appointment.id });
    return Response.json({ entitlement: updated });
  } catch (error) {
    if (String(error).includes("ENTITLEMENT_NOT_AVAILABLE") || String(error).includes("customer_entitlement_appointment_uq")) return Response.json({ error: "لا توجد جلسة متاحة أو سبق استهلاك رصيد هذه الزيارة" }, { status: 409 });
    return errorResponse(error);
  }
}
