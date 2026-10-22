import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inventoryWarehouses } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const patchSchema = z.object({ code: z.string().trim().min(1).max(24).regex(/^[a-zA-Z0-9._-]+$/).optional(), name: z.string().trim().min(2).max(120).optional(), address: z.string().trim().max(300).nullable().optional(), isActive: z.boolean().optional() }).refine((row) => Object.keys(row).length > 0, "أدخل حقلاً واحداً على الأقل");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("المخزن غير موجود", 404);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات المخزن");
    const { db, tenantId } = access.context;
    const [existing] = await db.select().from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, id), eq(inventoryWarehouses.tenantId, tenantId))).limit(1);
    if (!existing) throw new ApiError("المخزن غير موجود", 404);
    await requireWarehouseBranchMembership(access.context, existing.branchId);
    if (parsed.data.isActive === false && existing.isActive) {
      const balance = await access.context.env.DB.prepare("SELECT COALESCE(SUM(quantity_on_hand),0) AS quantity FROM inventory_balances WHERE tenant_id = ? AND warehouse_id = ?").bind(tenantId, id).first<{ quantity: number }>();
      const recipe = await access.context.env.DB.prepare("SELECT id FROM service_materials WHERE tenant_id = ? AND warehouse_id = ? AND is_active = 1 LIMIT 1").bind(tenantId, id).first();
      if ((balance?.quantity ?? 0) > 0 || recipe) throw new ApiError("انقل الرصيد وأزل ربط مواد الخدمات قبل إيقاف المخزن", 409);
    }
    const [warehouse] = await db.update(inventoryWarehouses).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(inventoryWarehouses.id, id), eq(inventoryWarehouses.tenantId, tenantId))).returning();
    await writeAudit(access.context, request, "inventory.warehouse_updated", "inventory_warehouse", id, { fields: Object.keys(parsed.data) });
    return Response.json({ warehouse });
  } catch (error) {
    if (String(error).includes("inventory_warehouses_tenant_code_uq")) return Response.json({ error: "رمز المخزن مستخدم من قبل" }, { status: 409 });
    return errorResponse(error);
  }
}
