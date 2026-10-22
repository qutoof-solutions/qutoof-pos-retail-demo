import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { branches, inventoryWarehouses } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, getAccessibleWarehouseIds, requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";
import { getTenantResourceLimit } from "@/lib/platform/addon-entitlement-query";

export const runtime = "edge";
const inputSchema = z.object({ code: z.string().trim().min(1).max(24).regex(/^[a-zA-Z0-9._-]+$/), name: z.string().trim().min(2).max(120), branchId: z.string().uuid().nullable().optional(), address: z.string().trim().max(300).nullable().optional() });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const [branchIds, warehouseIds] = await Promise.all([getAccessibleBranchIds(access.context), getAccessibleWarehouseIds(access.context)]);
  if (!branchIds.length) return Response.json({ branches: [], warehouses: [] }, { headers: { "Cache-Control": "no-store" } });
  const branchRows = await access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true), inArray(branches.id, branchIds)));
  const warehouseRows = warehouseIds.length ? await access.context.db.select({ id: inventoryWarehouses.id, code: inventoryWarehouses.code, name: inventoryWarehouses.name, branchId: inventoryWarehouses.branchId, isActive: inventoryWarehouses.isActive }).from(inventoryWarehouses).where(and(eq(inventoryWarehouses.tenantId, access.context.tenantId), inArray(inventoryWarehouses.id, warehouseIds))) : [];
  return Response.json({ branches: branchRows, warehouses: warehouseRows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من رمز المخزن واسمه والفرع المرتبط");
    const input = parsed.data;
    const [warehouseCountRow] = await access.context.db.select({ value: count() }).from(inventoryWarehouses).where(eq(inventoryWarehouses.tenantId, access.context.tenantId));
    const warehouseLimit = await getTenantResourceLimit(access.context.db, access.context.tenantId, "warehouse");
    if (warehouseLimit !== null && (warehouseCountRow?.value ?? 0) >= warehouseLimit) throw new ApiError("وصلت إلى الحد الحالي للمخازن. اطلب مخزناً إضافياً من صفحة الفوترة بعد اعتماد التحويل.", 409);
    if (input.branchId) {
      await requireBranchMembership(access.context, input.branchId);
      const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, access.context.tenantId))).limit(1);
      if (!branch) throw new ApiError("الفرع غير موجود في مساحة العمل", 404);
    } else await requireWarehouseBranchMembership(access.context, null);
    const id = crypto.randomUUID();
    const [warehouse] = await access.context.db.insert(inventoryWarehouses).values({ id, tenantId: access.context.tenantId, branchId: input.branchId ?? null, code: input.code, name: input.name, address: input.address ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, "inventory.warehouse_created", "inventory_warehouse", id, { code: input.code });
    return Response.json({ warehouse }, { status: 201 });
  } catch (error) {
    if (String(error).includes("inventory_warehouses_tenant_code_uq")) return Response.json({ error: "رمز المخزن مستخدم من قبل" }, { status: 409 });
    return errorResponse(error);
  }
}
