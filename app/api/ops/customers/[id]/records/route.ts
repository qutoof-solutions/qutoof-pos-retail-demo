import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, patientRecords } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { getCustomerBranchScope, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const recordInput = z.object({ recordType: z.enum(["clinical_note", "prescription", "follow_up"]), title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(12000), appointmentId: z.string().uuid().nullable().optional() });

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId } = await route.params;
    if (!z.string().uuid().safeParse(customerId).success) throw new ApiError("معرف العميل غير صالح");
    const parsed = recordInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات السجل السريري");
    const input = parsed.data;
    const scope = await getCustomerBranchScope(access.context, customerId);
    const [customer] = await access.context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, access.context.tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    if (isClinicalRole(access.context.session.role)) {
      if (!input.appointmentId) throw new ApiError("يجب ربط السجل بموعد مسند للطبيب", 400);
    }
    if (input.appointmentId) {
      const [visit] = await access.context.db.select({ id: appointments.id, branchId: appointments.branchId }).from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customerId), ...(isClinicalRole(access.context.session.role) ? [eq(appointments.providerId, access.context.user.id)] : []))).limit(1);
      if (!visit) throw new ApiError("الموعد المرتبط لا يخص هذا العميل", 404);
      await requireBranchMembership(access.context, visit.branchId);
    } else if (!scope.customerBranchId || !scope.accessibleBranchIds.includes(scope.customerBranchId)) {
      throw new ApiError("اختر موعدًا في أحد الفروع المسندة لربط السجل به", 400);
    }
    const id = crypto.randomUUID();
    const [record] = await access.context.db.insert(patientRecords).values({ id, tenantId: access.context.tenantId, customerId, appointmentId: input.appointmentId ?? null, authorId: access.context.user.id, recordType: input.recordType, title: input.title, body: input.body, metadataJson: "{}", createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, `patient_record.${input.recordType}`, "patient_record", id, { customerId });
    return Response.json({ record }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
