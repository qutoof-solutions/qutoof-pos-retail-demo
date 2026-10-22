import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { distributionRoutes, inventoryWarehouses, salesReps } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";
import { getTenantResourceLimit } from "@/lib/platform/addon-entitlement-query";

export const runtime = "edge";
const createSchema = z.object({ branchId: uuidSchema, routeId: uuidSchema.nullable().optional(), fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).nullable().optional(), vehicleName: z.string().trim().max(80).nullable().optional(), vehiclePlate: z.string().trim().max(40).nullable().optional(), commissionBps: z.number().int().min(0).max(10000).default(0) });
const patchSchema = z.object({ id: uuidSchema, isActive: z.boolean().optional(), routeId: uuidSchema.nullable().optional(), fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(40).nullable().optional(), vehicleName: z.string().trim().max(80).nullable().optional(), vehiclePlate: z.string().trim().max(40).nullable().optional(), commissionBps: z.number().int().min(0).max(10000).optional() }).refine((value) => Object.keys(value).length > 1, { message: "حدد حقلاً واحداً على الأقل للتحديث" });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  try {
    if (branchId) await requireBranchMembership(access.context, branchId);
    const filters = [eq(salesReps.tenantId, access.context.tenantId)];
    if (branchId) filters.push(eq(salesReps.branchId, branchId));
    const reps = await access.context.db.select({ id: salesReps.id, tenantId: salesReps.tenantId, branchId: salesReps.branchId, routeId: salesReps.routeId, vanWarehouseId: salesReps.vanWarehouseId, vanWarehouseName: inventoryWarehouses.name, fullName: salesReps.fullName, phone: salesReps.phone, vehicleName: salesReps.vehicleName, vehiclePlate: salesReps.vehiclePlate, commissionBps: salesReps.commissionBps, isActive: salesReps.isActive, routeName: distributionRoutes.name }).from(salesReps).leftJoin(distributionRoutes, and(eq(distributionRoutes.id, salesReps.routeId), eq(distributionRoutes.tenantId, access.context.tenantId))).leftJoin(inventoryWarehouses, and(eq(inventoryWarehouses.id, salesReps.vanWarehouseId), eq(inventoryWarehouses.tenantId, access.context.tenantId))).where(and(...filters)).orderBy(asc(salesReps.fullName));
    return Response.json({ reps }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر تحميل قائمة المندوبين"); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات المندوب والمركبة");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    if (input.routeId) {
      const [route] = await access.context.db.select({ id: distributionRoutes.id }).from(distributionRoutes).where(and(eq(distributionRoutes.id, input.routeId), eq(distributionRoutes.tenantId, access.context.tenantId), eq(distributionRoutes.branchId, input.branchId), eq(distributionRoutes.isActive, true))).limit(1);
      if (!route) throw new ApiError("خط السير غير نشط أو لا يتبع الفرع", 409);
    }
    const [warehouseCount] = await access.context.db.select({ value: count() }).from(inventoryWarehouses).where(eq(inventoryWarehouses.tenantId, access.context.tenantId));
    const warehouseLimit = await getTenantResourceLimit(access.context.db, access.context.tenantId, "warehouse");
    if (warehouseLimit !== null && (warehouseCount?.value ?? 0) >= warehouseLimit) throw new ApiError("وصلت إلى الحد الحالي للمخازن. اطلب مخزناً إضافياً من صفحة الفوترة بعد اعتماد التحويل.", 409);
    const now = new Date();
    const repId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const warehouse = { id: warehouseId, tenantId: access.context.tenantId, branchId: input.branchId, code: `VAN-${repId.slice(0, 8).toUpperCase()}`, name: `عهدة سيارة · ${input.fullName}`, address: input.vehiclePlate?.trim() || null, isActive: true, createdAt: now, updatedAt: now };
    const rep = { id: repId, tenantId: access.context.tenantId, branchId: input.branchId, routeId: input.routeId ?? null, vanWarehouseId: warehouseId, fullName: input.fullName, phone: input.phone?.trim() || null, vehicleName: input.vehicleName?.trim() || null, vehiclePlate: input.vehiclePlate?.trim() || null, commissionBps: input.commissionBps, isActive: true, createdBy: access.context.user.id, createdAt: now, updatedAt: now };
    await access.context.db.batch([access.context.db.insert(inventoryWarehouses).values(warehouse), access.context.db.insert(salesReps).values(rep)]);
    await writeAudit(access.context, request, "distribution.rep.created", "sales_rep", repId, { branchId: rep.branchId, vanWarehouseId: warehouseId, commissionBps: rep.commissionBps });
    return Response.json({ rep: { ...rep, warehouseName: warehouse.name } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر إنشاء المندوب ومخزن السيارة"); }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات التحديث غير صالحة");
    const [rep] = await access.context.db.select().from(salesReps).where(and(eq(salesReps.id, parsed.data.id), eq(salesReps.tenantId, access.context.tenantId))).limit(1);
    if (!rep) throw new ApiError("المندوب غير موجود", 404);
    await requireBranchMembership(access.context, rep.branchId);
    if (parsed.data.routeId) {
      const [route] = await access.context.db.select({ id: distributionRoutes.id }).from(distributionRoutes).where(and(eq(distributionRoutes.id, parsed.data.routeId), eq(distributionRoutes.tenantId, access.context.tenantId), eq(distributionRoutes.branchId, rep.branchId), eq(distributionRoutes.isActive, true))).limit(1);
      if (!route) throw new ApiError("خط السير غير نشط أو لا يتبع فرع المندوب", 409);
    }
    const update = { ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}), ...(parsed.data.routeId !== undefined ? { routeId: parsed.data.routeId } : {}), ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}), ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone?.trim() || null } : {}), ...(parsed.data.vehicleName !== undefined ? { vehicleName: parsed.data.vehicleName?.trim() || null } : {}), ...(parsed.data.vehiclePlate !== undefined ? { vehiclePlate: parsed.data.vehiclePlate?.trim() || null } : {}), ...(parsed.data.commissionBps !== undefined ? { commissionBps: parsed.data.commissionBps } : {}), updatedAt: new Date() };
    await access.context.db.update(salesReps).set(update).where(and(eq(salesReps.id, rep.id), eq(salesReps.tenantId, access.context.tenantId))).run();
    await writeAudit(access.context, request, "distribution.rep.updated", "sales_rep", rep.id, { ...update, isActive: parsed.data.isActive ?? rep.isActive });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "تعذر تحديث بيانات المندوب"); }
}
