import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { customers, distributionCustomerAssignments, distributionRoutes, salesReps } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const assignSchema = z.object({ customerId: uuidSchema, routeId: uuidSchema, salesRepId: uuidSchema });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  try {
    if (branchId) await requireBranchMembership(access.context, branchId);
    const filters = [eq(distributionCustomerAssignments.tenantId, access.context.tenantId)];
    if (branchId) filters.push(eq(distributionRoutes.branchId, branchId));
    const assignments = await access.context.db.select({ id: distributionCustomerAssignments.id, customerId: distributionCustomerAssignments.customerId, customerName: customers.fullName, customerPhone: customers.phone, routeId: distributionCustomerAssignments.routeId, routeName: distributionRoutes.name, salesRepId: distributionCustomerAssignments.salesRepId, salesRepName: salesReps.fullName, branchId: distributionRoutes.branchId }).from(distributionCustomerAssignments).innerJoin(customers, and(eq(customers.id, distributionCustomerAssignments.customerId), eq(customers.tenantId, access.context.tenantId))).innerJoin(distributionRoutes, and(eq(distributionRoutes.id, distributionCustomerAssignments.routeId), eq(distributionRoutes.tenantId, access.context.tenantId))).innerJoin(salesReps, and(eq(salesReps.id, distributionCustomerAssignments.salesRepId), eq(salesReps.tenantId, access.context.tenantId))).where(and(...filters)).orderBy(asc(customers.fullName));
    return Response.json({ assignments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر تحميل تعيينات العملاء"); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = assignSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات تعيين العميل غير صالحة");
    const input = parsed.data;
    const [route] = await access.context.db.select().from(distributionRoutes).where(and(eq(distributionRoutes.id, input.routeId), eq(distributionRoutes.tenantId, access.context.tenantId), eq(distributionRoutes.isActive, true))).limit(1);
    const [rep] = await access.context.db.select().from(salesReps).where(and(eq(salesReps.id, input.salesRepId), eq(salesReps.tenantId, access.context.tenantId), eq(salesReps.isActive, true))).limit(1);
    const [customer] = await access.context.db.select({ id: customers.id, branchId: customers.branchId }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, access.context.tenantId))).limit(1);
    if (!route || !rep || !customer) throw new ApiError("العميل أو المندوب أو خط السير غير موجود أو غير نشط", 404);
    if (rep.branchId !== route.branchId || (customer.branchId && customer.branchId !== route.branchId)) throw new ApiError("يجب أن يتبع العميل والمندوب وخط السير الفرع نفسه", 409);
    await requireBranchMembership(access.context, route.branchId);
    if (rep.routeId && rep.routeId !== route.id) throw new ApiError("خط السير المحدد لا يطابق خط المندوب الحالي", 409);
    const now = new Date();
    const assignment = { id: crypto.randomUUID(), tenantId: access.context.tenantId, customerId: input.customerId, routeId: input.routeId, salesRepId: input.salesRepId, assignedBy: access.context.user.id, createdAt: now, updatedAt: now };
    await access.context.db.insert(distributionCustomerAssignments).values(assignment).onConflictDoUpdate({ target: [distributionCustomerAssignments.tenantId, distributionCustomerAssignments.customerId], set: { routeId: assignment.routeId, salesRepId: assignment.salesRepId, assignedBy: assignment.assignedBy, updatedAt: now } }).run();
    await writeAudit(access.context, request, "distribution.customer.assigned", "customer", input.customerId, { routeId: input.routeId, salesRepId: input.salesRepId });
    return Response.json({ ok: true, assignment }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر ربط العميل بخط السير"); }
}
