import { z } from "zod";
import { inventoryItemUnits } from "@/lib/db/schema";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { and, eq } from "drizzle-orm";

export const runtime = "edge";
const unitSchema = z.object({
  itemId: uuidSchema,
  code: z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N}._-]+$/u),
  name: z.string().trim().min(1).max(60),
  conversionFactor: z.number().finite().gt(0).max(1_000_000),
  barcode: z.string().trim().max(80).nullable().optional(),
  purchaseCost: moneySchema.max(10_000_000).default(0),
  sellingPrice: moneySchema.max(10_000_000).default(0),
  wholesalePrice: moneySchema.max(10_000_000).default(0),
  distributorPrice: moneySchema.max(10_000_000).default(0),
});

const patchSchema = z.object({
  id: uuidSchema, code: unitSchema.shape.code.optional(), name: unitSchema.shape.name.optional(), conversionFactor: unitSchema.shape.conversionFactor.optional(), barcode: unitSchema.shape.barcode.optional(), purchaseCost: unitSchema.shape.purchaseCost.optional(), sellingPrice: unitSchema.shape.sellingPrice.optional(), wholesalePrice: unitSchema.shape.wholesalePrice.optional(), distributorPrice: unitSchema.shape.distributorPrice.optional(), isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 1, { message: "حدد حقلاً واحداً على الأقل للتحديث" });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper", "reception"]);
  if (!access.ok) return access.response;
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId || !uuidSchema.safeParse(itemId).success) return Response.json({ error: "معرف الصنف مطلوب" }, { status: 400 });
  const item = await access.context.env.DB.prepare("SELECT id, quantity_scale AS quantityScale FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1").bind(itemId, access.context.tenantId).first<{ id: string; quantityScale: number }>();
  if (!item) return Response.json({ error: "الصنف غير موجود" }, { status: 404 });
  const rows = await access.context.db.select().from(inventoryItemUnits).where(and(eq(inventoryItemUnits.tenantId, access.context.tenantId), eq(inventoryItemUnits.itemId, itemId), eq(inventoryItemUnits.isActive, true)));
  const divisor = 10 ** item.quantityScale;
  return Response.json({ units: rows.map((row) => ({ ...row, conversionFactor: row.conversionFactor / divisor })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const parsed = unitSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "بيانات الوحدة غير صالحة");
    const input = parsed.data;
    const item = await access.context.env.DB.prepare("SELECT id, quantity_scale AS quantityScale FROM inventory_items WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.itemId, access.context.tenantId).first<{ id: string; quantityScale: number }>();
    if (!item) throw new ApiError("الصنف غير موجود أو غير نشط", 404);
    const conversionFactor = Math.round(input.conversionFactor * (10 ** item.quantityScale));
    if (!Number.isSafeInteger(conversionFactor) || conversionFactor < 1) throw new ApiError("معامل التحويل غير صالح");
    const now = new Date();
    const row = { id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: input.itemId, code: input.code, name: input.name, conversionFactor, barcode: input.barcode?.trim() || null, purchaseCostMinor: Math.round(input.purchaseCost * 100), sellingPriceMinor: Math.round(input.sellingPrice * 100), wholesalePriceMinor: Math.round(input.wholesalePrice * 100), distributorPriceMinor: Math.round(input.distributorPrice * 100), isBase: false, isActive: true, createdAt: now, updatedAt: now };
    const [unit] = await access.context.db.insert(inventoryItemUnits).values(row).returning();
    await writeAudit(access.context, request, "inventory.unit_created", "inventory_item_unit", row.id, { itemId: input.itemId, conversionFactor });
    return Response.json({ unit: { ...unit, conversionFactor: unit.conversionFactor / (10 ** item.quantityScale) } }, { status: 201 });
  } catch (error) {
    if (String(error).includes("inventory_item_units_item_code_uq")) return Response.json({ error: "رمز الوحدة مستخدم لهذا الصنف" }, { status: 409 });
    if (String(error).includes("inventory_item_units_barcode_uq")) return Response.json({ error: "باركود الوحدة مستخدم مسبقاً" }, { status: 409 });
    return errorResponse(error);
  }
}


export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "بيانات الوحدة غير صالحة");
    const input = parsed.data;
    const unit = await access.context.env.DB.prepare("SELECT id, item_id AS itemId, conversion_factor AS conversionFactor, is_base AS isBase FROM inventory_item_units WHERE id = ? AND tenant_id = ? LIMIT 1").bind(input.id, access.context.tenantId).first<{ id: string; itemId: string; conversionFactor: number; isBase: number }>();
    if (!unit) throw new ApiError("الوحدة غير موجودة", 404);
    if (input.isActive === false && unit.isBase) throw new ApiError("لا يمكن تعطيل وحدة الأساس", 409);
    const refs = await access.context.env.DB.prepare("SELECT (SELECT COUNT(*) FROM invoice_items WHERE tenant_id = ? AND unit_id = ?) + (SELECT COUNT(*) FROM purchase_invoice_lines WHERE tenant_id = ? AND unit_id = ?) + (SELECT COUNT(*) FROM stock_movements WHERE tenant_id = ? AND unit_id = ?) AS count").bind(access.context.tenantId, input.id, access.context.tenantId, input.id, access.context.tenantId, input.id).first<{ count: number }>();
    const hasHistory = (refs?.count ?? 0) > 0;
    const mutatingDefinition = [input.code, input.name, input.conversionFactor, input.barcode, input.purchaseCost, input.sellingPrice, input.wholesalePrice, input.distributorPrice].some((value) => value !== undefined);
    if (hasHistory && mutatingDefinition) throw new ApiError("لا يمكن تعديل تعريف وحدة مستخدمة؛ عطّلها وأنشئ وحدة جديدة حتى لا يتغير التاريخ", 409);
    const item = await access.context.env.DB.prepare("SELECT quantity_scale AS quantityScale FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1").bind(unit.itemId, access.context.tenantId).first<{ quantityScale: number }>();
    if (!item) throw new ApiError("الصنف غير موجود", 404);
    const divisor = 10 ** item.quantityScale;
    const factor = input.conversionFactor === undefined ? undefined : Math.round(input.conversionFactor * divisor);
    if (factor !== undefined && (!Number.isSafeInteger(factor) || factor < 1)) throw new ApiError("معامل التحويل غير صالح");
    const now = new Date();
    await access.context.db.update(inventoryItemUnits).set({ ...(input.code !== undefined ? { code: input.code } : {}), ...(input.name !== undefined ? { name: input.name } : {}), ...(factor !== undefined ? { conversionFactor: factor } : {}), ...(input.barcode !== undefined ? { barcode: input.barcode?.trim() || null } : {}), ...(input.purchaseCost !== undefined ? { purchaseCostMinor: Math.round(input.purchaseCost * 100) } : {}), ...(input.sellingPrice !== undefined ? { sellingPriceMinor: Math.round(input.sellingPrice * 100) } : {}), ...(input.wholesalePrice !== undefined ? { wholesalePriceMinor: Math.round(input.wholesalePrice * 100) } : {}), ...(input.distributorPrice !== undefined ? { distributorPriceMinor: Math.round(input.distributorPrice * 100) } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), updatedAt: now }).where(and(eq(inventoryItemUnits.id, input.id), eq(inventoryItemUnits.tenantId, access.context.tenantId))).run();
    await writeAudit(access.context, request, "inventory.unit_updated", "inventory_item_unit", input.id, { hasHistory, isActive: input.isActive });
    return Response.json({ ok: true });
  } catch (error) {
    if (String(error).includes("inventory_item_units_item_code_uq")) return Response.json({ error: "رمز الوحدة مستخدم لهذا الصنف" }, { status: 409 });
    if (String(error).includes("inventory_item_units_barcode_uq")) return Response.json({ error: "باركود الوحدة مستخدم مسبقاً" }, { status: 409 });
    return errorResponse(error);
  }
}
