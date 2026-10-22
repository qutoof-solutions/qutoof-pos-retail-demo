import { z } from "zod";
import { inventoryItems } from "@/lib/db/schema";
import { moneySchema } from "@/lib/operations/validation";
import { displayConversionFactor } from "@/lib/operations/uom";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, getAccessibleWarehouseIds } from "@/lib/server/branch-access";

export const runtime = "edge";
const skuSchema = z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9._-]+$/);
const variantSchema = z.object({
  sku: skuSchema,
  barcode: z.string().trim().max(80).nullable().optional(),
  size: z.string().trim().max(32).nullable().optional(),
  color: z.string().trim().max(48).nullable().optional(),
});
const itemInput = z.object({
  sku: skuSchema,
  barcode: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().min(2).max(80),
  unitCode: z.string().trim().min(1).max(24),
  quantityScale: z.number().int().min(0).max(4).default(0),
  reorderThreshold: z.number().finite().min(0).max(1_000_000).default(0),
  defaultCost: moneySchema.max(10_000_000).default(0),
  sellingPrice: moneySchema.max(10_000_000).default(0),
  wholesalePrice: moneySchema.max(10_000_000).optional(),
  distributorPrice: moneySchema.max(10_000_000).optional(),
  tracksBatches: z.boolean().default(false),
  tracksExpiry: z.boolean().default(false),
  variants: z.array(variantSchema).max(100).optional(),
}).superRefine((row, context) => {
  if (row.tracksExpiry && !row.tracksBatches) context.addIssue({ code: "custom", message: "تتبع الصلاحية يتطلب تفعيل تتبع التشغيلة", path: ["tracksExpiry"] });
  if (row.variants?.length) {
    const skus = new Set<string>();
    const barcodes = new Set<string>();
    row.variants.forEach((variant, index) => {
      if (skus.has(variant.sku.toLocaleLowerCase())) context.addIssue({ code: "custom", message: "رموز SKU للمتغيرات يجب أن تكون فريدة", path: ["variants", index, "sku"] });
      skus.add(variant.sku.toLocaleLowerCase());
      const barcode = variant.barcode?.trim() || variant.sku;
      if (barcodes.has(barcode.toLocaleLowerCase())) context.addIssue({ code: "custom", message: "الباركود الافتراضي/المخصص يجب أن يكون فريداً لكل متغير", path: ["variants", index, "barcode"] });
      barcodes.add(barcode.toLocaleLowerCase());
    });
  }
});

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const search = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const expiryCutoff = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ items: [], balances: [], warehouses: [], alerts: [], expiryAlerts: [], businessName: access.context.tenant.name }, { headers: { "Cache-Control": "no-store" } });
  const warehousePlaceholders = warehouseIds.map(() => "?").join(",");
  const bind: unknown[] = [...warehouseIds, access.context.tenantId];
  const where = search ? "AND (i.name LIKE ? ESCAPE '\\' OR i.sku LIKE ? ESCAPE '\\' OR i.barcode = ? OR i.variant_size LIKE ? ESCAPE '\\' OR i.variant_color LIKE ? ESCAPE '\\')" : "";
  if (search) { const escaped = `%${search.replace(/[\\%_]/g, "\\$&")}%`; bind.push(escaped, escaped, search, escaped, escaped); }
  const [items, balances, warehouses, alerts, expiryAlerts] = await Promise.all([
    access.context.env.DB.prepare(`SELECT i.id, i.sku, i.barcode, i.name, i.description, i.category, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, i.reorder_threshold AS reorderThreshold, i.default_cost_minor AS defaultCostMinor, i.selling_price_minor AS sellingPriceMinor, i.wholesale_price_minor AS wholesalePriceMinor, i.distributor_price_minor AS distributorPriceMinor, i.variant_group_id AS variantGroupId, i.variant_size AS variantSize, i.variant_color AS variantColor, i.tracks_batches AS tracksBatches, i.tracks_expiry AS tracksExpiry, i.is_active AS isActive, COALESCE(SUM(b.quantity_on_hand), 0) AS quantityOnHand FROM inventory_items i LEFT JOIN inventory_balances b ON b.tenant_id = i.tenant_id AND b.item_id = i.id AND b.warehouse_id IN (${warehousePlaceholders}) WHERE i.tenant_id = ? ${where} GROUP BY i.id ORDER BY i.name, i.variant_size, i.variant_color LIMIT 500`).bind(...bind).all(),
    access.context.env.DB.prepare(`SELECT b.item_id AS itemId, i.name AS itemName, i.sku, i.variant_size AS variantSize, i.variant_color AS variantColor, b.warehouse_id AS warehouseId, w.name AS warehouseName, b.batch_id AS batchId, lot.lot_number AS lotNumber, lot.expires_on AS expiresOn, b.quantity_on_hand AS quantityOnHand, i.unit_code AS unitCode, i.quantity_scale AS quantityScale FROM inventory_balances b JOIN inventory_items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id JOIN inventory_warehouses w ON w.id = b.warehouse_id AND w.tenant_id = b.tenant_id LEFT JOIN inventory_batches lot ON lot.id = b.batch_id AND lot.tenant_id = b.tenant_id WHERE b.tenant_id = ? AND b.warehouse_id IN (${warehousePlaceholders}) AND b.quantity_on_hand > 0 ORDER BY i.name, i.variant_size, i.variant_color, w.name, lot.expires_on, lot.received_at LIMIT 1000`).bind(access.context.tenantId, ...warehouseIds).all(),
    access.context.env.DB.prepare(`SELECT id, code, name, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE tenant_id = ? AND id IN (${warehousePlaceholders}) ORDER BY name`).bind(access.context.tenantId, ...warehouseIds).all(),
    access.context.env.DB.prepare(`SELECT i.id, i.name, i.sku, i.variant_size AS variantSize, i.variant_color AS variantColor, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, i.reorder_threshold AS reorderThreshold, COALESCE(SUM(b.quantity_on_hand), 0) AS quantityOnHand, 'reorder' AS alertType FROM inventory_items i LEFT JOIN inventory_balances b ON b.tenant_id = i.tenant_id AND b.item_id = i.id AND b.warehouse_id IN (${warehousePlaceholders}) WHERE i.tenant_id = ? AND i.is_active = 1 GROUP BY i.id HAVING COALESCE(SUM(b.quantity_on_hand), 0) <= i.reorder_threshold ORDER BY i.name LIMIT 200`).bind(...warehouseIds, access.context.tenantId).all(),
    access.context.env.DB.prepare(`SELECT i.id, i.name, i.sku, i.variant_size AS variantSize, i.variant_color AS variantColor, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, b.warehouse_id AS warehouseId, w.name AS warehouseName, lot.lot_number AS lotNumber, lot.expires_on AS expiresOn, b.quantity_on_hand AS quantityOnHand, CASE WHEN lot.expires_on < ? THEN 'expired' ELSE 'near_expiry' END AS alertType FROM inventory_balances b JOIN inventory_items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id JOIN inventory_warehouses w ON w.id = b.warehouse_id AND w.tenant_id = b.tenant_id JOIN inventory_batches lot ON lot.id = b.batch_id AND lot.tenant_id = b.tenant_id WHERE b.tenant_id = ? AND b.warehouse_id IN (${warehousePlaceholders}) AND b.quantity_on_hand > 0 AND lot.expires_on IS NOT NULL AND lot.expires_on <= ? AND i.is_active = 1 ORDER BY lot.expires_on, i.name LIMIT 300`).bind(today, access.context.tenantId, ...warehouseIds, expiryCutoff).all(),
  ]);
  const itemIds = items.results.map((row) => String((row as { id: string }).id));
  const unitRows = itemIds.length ? await access.context.env.DB.prepare(`SELECT id, item_id AS itemId, code, name, conversion_factor AS conversionFactor, barcode, purchase_cost_minor AS purchaseCostMinor, selling_price_minor AS sellingPriceMinor, wholesale_price_minor AS wholesalePriceMinor, distributor_price_minor AS distributorPriceMinor FROM inventory_item_units WHERE tenant_id = ? AND is_active = 1 AND item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY is_base DESC, code`).bind(access.context.tenantId, ...itemIds).all() : { results: [] };
  const unitsByItem = new Map<string, unknown[]>();
  for (const unit of unitRows.results) {
    const row = unit as { itemId: string; conversionFactor: number };
    const item = items.results.find((candidate) => String((candidate as { id: string }).id) === row.itemId) as { quantityScale: number } | undefined;
    const dto = item ? displayConversionFactor(row, item.quantityScale) : row;
    unitsByItem.set(row.itemId, [...(unitsByItem.get(row.itemId) ?? []), dto]);
  }
  const itemResults = items.results.map((row) => ({ ...(row as Record<string, unknown>), units: unitsByItem.get(String((row as { id: string }).id)) ?? [] }));
  return Response.json({ items: itemResults, balances: balances.results, warehouses: warehouses.results, alerts: alerts.results, expiryAlerts: expiryAlerts.results, businessName: access.context.tenant.name }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    if (!(await getAccessibleBranchIds(access.context)).length) throw new ApiError("لا تملك عضوية في أي فرع", 403);
    const parsed = itemInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || "تحقق من بيانات الصنف والمتغيرات والأسعار");
    const input = parsed.data;
    const now = new Date();
    const tenantId = access.context.tenantId;
    const variantGroupId = input.variants?.length ? crypto.randomUUID() : null;
    const common = {
      tenantId, name: input.name, description: input.description?.trim() || null, category: input.category, unitCode: input.unitCode,
      quantityScale: input.quantityScale, reorderThreshold: Math.round(input.reorderThreshold * (10 ** input.quantityScale)),
      defaultCostMinor: Math.round(input.defaultCost * 100), sellingPriceMinor: Math.round(input.sellingPrice * 100),
      wholesalePriceMinor: Math.round((input.wholesalePrice ?? input.sellingPrice) * 100), distributorPriceMinor: Math.round((input.distributorPrice ?? input.sellingPrice) * 100),
      tracksBatches: input.tracksBatches, tracksExpiry: input.tracksExpiry, isActive: true, createdAt: now, updatedAt: now,
    };
    const rows = input.variants?.length ? input.variants.map((variant) => ({
      ...common, id: crypto.randomUUID(), sku: variant.sku, barcode: variant.barcode?.trim() || variant.sku,
      variantGroupId, variantSize: variant.size?.trim() || null, variantColor: variant.color?.trim() || null,
    })) : [{
      ...common, id: crypto.randomUUID(), sku: input.sku, barcode: input.barcode?.trim() || null,
      variantGroupId: null, variantSize: null, variantColor: null,
    }];
    const items = await access.context.db.insert(inventoryItems).values(rows).returning();
    await writeAudit(access.context, request, "inventory.item_created", "inventory_item", variantGroupId ?? items[0]!.id, { skuCount: items.length, variantGroupId, itemIds: items.map((row) => row.id) });
    return Response.json({ item: items[0], items, variantGroupId }, { status: 201 });
  } catch (error) {
    if (String(error).includes("inventory_items_tenant_sku_uq")) return Response.json({ error: "رمز SKU مستخدم في هذا النشاط" }, { status: 409 });
    if (String(error).includes("inventory_items_tenant_barcode_uq")) return Response.json({ error: "الباركود مستخدم في هذا النشاط" }, { status: 409 });
    return errorResponse(error);
  }
}
