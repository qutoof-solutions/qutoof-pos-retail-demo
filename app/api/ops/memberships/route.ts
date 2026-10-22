import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { branches, customerMemberships, customers, subscriptionPlans } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getCustomerBranchScope, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const uuid = z.string().uuid();
const inputSchema = z.object({
  branchId: uuid,
  customerId: uuid,
  planId: uuid.nullable().optional(),
  planName: z.string().trim().min(2).max(120).optional(),
  price: z.number().finite().min(0).max(10_000_000).default(0),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).superRefine((input, context) => {
  if (!input.planId && !input.planName) context.addIssue({ code: "custom", message: "اختر خطة أو أدخل اسم العضوية", path: ["planName"] });
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) context.addIssue({ code: "custom", message: "تاريخ نهاية العضوية يجب أن يكون بعد تاريخ البداية", path: ["endsAt"] });
});

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  if (access.context.tenant.vertical !== "sports") return Response.json({ error: "إدارة عضويات الجيم متاحة للأنشطة الرياضية فقط" }, { status: 403 });
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || "تحقق من بيانات العضوية");
    const input = parsed.data;
    const { db, tenantId } = access.context;
    await requireBranchMembership(access.context, input.branchId);
    const [customer] = await db.select({ id: customers.id, branchId: customers.branchId }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
    if (!customer) throw new ApiError("ملف العميل غير موجود", 404);
    const customerScope = await getCustomerBranchScope(access.context, input.customerId);
    if (!customerScope.accessibleBranchIds.includes(input.branchId)) throw new ApiError("لا تملك صلاحية إنشاء العضوية لهذا الفرع", 403);
    if (customer.branchId !== input.branchId) {
      const hasVisit = customerScope.appointmentIds.length ? await access.context.env.DB.prepare(`SELECT id FROM appointments WHERE tenant_id = ? AND customer_id = ? AND branch_id = ? LIMIT 1`).bind(tenantId, input.customerId, input.branchId).first() : null;
      if (!hasVisit) throw new ApiError("ملف العميل غير مرتبط بهذا الفرع", 404);
    }
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط", 404);
    let planId: string | null = null;
    let planName = input.planName?.trim() || "";
    let priceMinor = Math.round(input.price * 100);
    if (input.planId) {
      const [plan] = await db.select({ id: subscriptionPlans.id, nameAr: subscriptionPlans.nameAr, nameEn: subscriptionPlans.nameEn, priceMinor: subscriptionPlans.priceMinor }).from(subscriptionPlans).where(and(eq(subscriptionPlans.id, input.planId), eq(subscriptionPlans.isActive, true), or(eq(subscriptionPlans.tenantId, tenantId), isNull(subscriptionPlans.tenantId)))).limit(1);
      if (!plan) throw new ApiError("الخطة غير موجودة أو غير متاحة لهذا النشاط", 404);
      planId = plan.id;
      planName = plan.nameAr || plan.nameEn;
      priceMinor = plan.priceMinor;
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!Number.isSafeInteger(priceMinor)) throw new ApiError("سعر العضوية غير صالح");
    const now = new Date();
    const [membership] = await db.insert(customerMemberships).values({
      id: crypto.randomUUID(), tenantId, branchId: input.branchId, customerId: input.customerId, planId,
      planNameSnapshot: planName, priceMinorSnapshot: priceMinor, startsAt, endsAt, status: "active", frozenDaysTotal: 0,
      notes: input.notes?.trim() || null, createdBy: access.context.user.id, createdAt: now, updatedAt: now,
    }).returning();
    await writeAudit(access.context, request, "membership.created", "customer_membership", membership!.id, { customerId: input.customerId, branchId: input.branchId, planId, endsAt: endsAt.toISOString() });
    return Response.json({ membership }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
