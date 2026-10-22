import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inventoryItems } from "@/lib/db/schema";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";

export const runtime = "edge";
const patchSchema = z.object({ sku: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9._-]+$/).optional(), barcode: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(1000).nullable().optional(), category: z.string().trim().min(2).max(80).optional(), variantSize: z.string().trim().max(32).nullable().optional(), variantColor: z.string().trim().max(48).nullable().optional(), reorderThreshold: z.number().finite().min(0).max(1_000_000).optional(), defaultCost: moneySchema.max(10_000_000).optional(), sellingPrice: moneySchema.max(10_000_000).optional(), wholesalePrice: moneySchema.max(10_000_000).optional(), distributorPrice: moneySchema.max(10_000_000).optional(), isActive: z.boolean().optional() }).refine((row) => Object.keys(row).length > 0, "أدخل حقلاً واحداً على الأقل للتحديث");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("الصنف غير موجود", 404);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات تعديل الصنف");
    const { db, tenantId } = access.context;
    if (!(await getAccessibleBranchIds(access.context)).length) throw new ApiError("لا تملك عضوية في أي فرع", 403);
    const [existing] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, tenantId))).limit(1);
    if (!existing) throw new ApiError("الصنف غير موجود", 404);
    const input = parsed.data;
    if (input.isActive === false && existing.isActive) {
      const balance = await access.context.env.DB.prepare("SELECT COALESCE(SUM(quantity_on_hand),0) AS quantity FROM inventory_balances WHERE tenant_id = ? AND item_id = ?").bind(tenantId, id).first<{ quantity: number }>();
      if ((balance?.quantity ?? 0) > 0) throw new ApiError("انقل أو اصرف الرصيد المتبقي قبل إيقاف الصنف", 409);
    }
    const update: Partial<typeof inventoryItems.$inferInsert> = { updatedAt: new Date() };
    if (input.sku !== undefined) update.sku = input.sku;
    if (input.barcode !== undefined) update.barcode = input.barcode?.trim() || null;
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description?.trim() || null;
    if (input.category !== undefined) update.category = input.category;
    if (input.variantSize !== undefined) update.variantSize = input.variantSize?.trim() || null;
    if (input.variantColor !== undefined) update.variantColor = input.variantColor?.trim() || null;
    if (input.reorderThreshold !== undefined) update.reorderThreshold = Math.round(input.reorderThreshold * (10 ** existing.quantityScale));
    if (input.defaultCost !== undefined) update.defaultCostMinor = Math.round(input.defaultCost * 100);
    if (input.sellingPrice !== undefined) update.sellingPriceMinor = Math.round(input.sellingPrice * 100);
    if (input.wholesalePrice !== undefined) update.wholesalePriceMinor = Math.round(input.wholesalePrice * 100);
    if (input.distributorPrice !== undefined) update.distributorPriceMinor = Math.round(input.distributorPrice * 100);
    if (input.isActive !== undefined) update.isActive = input.isActive;
    const [item] = await db.update(inventoryItems).set(update).where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, tenantId))).returning();
    await writeAudit(access.context, request, "inventory.item_updated", "inventory_item", id, { fields: Object.keys(input), isActive: input.isActive });
    return Response.json({ item });
  } catch (error) {
    if (String(error).includes("inventory_items_tenant_sku_uq")) return Response.json({ error: "رمز SKU مستخدم في هذا النشاط" }, { status: 409 });
    if (String(error).includes("inventory_items_tenant_barcode_uq")) return Response.json({ error: "الباركود مستخدم في هذا النشاط" }, { status: 409 });
    return errorResponse(error);
  }
}
