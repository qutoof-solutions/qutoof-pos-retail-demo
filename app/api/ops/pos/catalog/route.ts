import { and, eq } from "drizzle-orm";
import { branches } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/operations/validation";
import { requireOperationAccess } from "@/lib/server/operations";
import { getAccessibleWarehouseIds, requireBranchMembership } from "@/lib/server/branch-access";
import { signOfflinePrice } from "@/lib/operations/offline-price";

export const runtime = "edge";
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "storekeeper", "provider"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId || !uuidSchema.safeParse(branchId).success) return Response.json({ error: "الفرع مطلوب" }, { status: 400 });
  await requireBranchMembership(access.context, branchId);
  const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
  if (!branch) return Response.json({ error: "الفرع غير موجود" }, { status: 404 });
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ products: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const rows = await access.context.env.DB.prepare(`SELECT i.id AS itemId, i.sku, i.barcode, i.name, i.variant_group_id AS variantGroupId, i.variant_size AS variantSize, i.variant_color AS variantColor, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, i.selling_price_minor AS sellingPriceMinor, i.wholesale_price_minor AS wholesalePriceMinor, i.distributor_price_minor AS distributorPriceMinor, w.id AS warehouseId, w.name AS warehouseName, COALESCE(SUM(b.quantity_on_hand), 0) AS quantityOnHand FROM inventory_items i JOIN inventory_warehouses w ON w.tenant_id = i.tenant_id AND w.is_active = 1 AND (w.branch_id IS NULL OR w.branch_id = ?) AND w.id IN (${placeholders}) LEFT JOIN inventory_balances b ON b.tenant_id = i.tenant_id AND b.item_id = i.id AND b.warehouse_id = w.id WHERE i.tenant_id = ? AND i.is_active = 1 AND (i.selling_price_minor > 0 OR i.wholesale_price_minor > 0 OR i.distributor_price_minor > 0) GROUP BY i.id, w.id ORDER BY i.name, i.variant_size, i.variant_color, w.name LIMIT 2000`).bind(branchId, ...warehouseIds, access.context.tenantId).all();
  const itemIds = rows.results.map((row) => String((row as { itemId: string }).itemId));
  const unitRows = itemIds.length ? await access.context.env.DB.prepare(`SELECT id, item_id AS itemId, code, name, conversion_factor AS conversionFactor, barcode, purchase_cost_minor AS purchaseCostMinor, selling_price_minor AS sellingPriceMinor, wholesale_price_minor AS wholesalePriceMinor, distributor_price_minor AS distributorPriceMinor FROM inventory_item_units WHERE tenant_id = ? AND is_active = 1 AND item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY is_base DESC, code`).bind(access.context.tenantId, ...itemIds).all() : { results: [] };
  const unitsByItem = new Map<string, unknown[]>();
  for (const unit of unitRows.results) { const row = unit as { itemId: string }; unitsByItem.set(row.itemId, [...(unitsByItem.get(row.itemId) ?? []), unit]); }
  const products = await Promise.all(rows.results.map(async (row) => {
    const product = row as { itemId: string; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number };
    const sign = async (unitPriceMinor: number, unitId: string | null = null) => unitPriceMinor > 0 ? signOfflinePrice(access.context.env.SESSION_SECRET!, { tenantId: access.context.tenantId, itemType: "inventory", itemId: product.itemId, unitId, branchId, unitPriceMinor, issuedAt: Date.now() }) : null;
    const offlinePriceTokens = { retail: await sign(product.sellingPriceMinor), wholesale: await sign(product.wholesalePriceMinor), distributor: await sign(product.distributorPriceMinor) };
    const units = await Promise.all((unitsByItem.get(product.itemId) ?? []).map(async (unit) => {
      const value = unit as { id: string; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number };
      const unitOfflinePriceTokens = { retail: await sign(value.sellingPriceMinor, value.id), wholesale: await sign(value.wholesalePriceMinor, value.id), distributor: await sign(value.distributorPriceMinor, value.id) };
      return { ...(unit as Record<string, unknown>), offlinePriceToken: unitOfflinePriceTokens.retail, offlinePriceTokens: unitOfflinePriceTokens };
    }));
    return { ...(row as Record<string, unknown>), units, offlinePriceToken: offlinePriceTokens.retail, offlinePriceTokens };
  }));
  return Response.json({ products, scope: { tenantId: access.context.tenantId, userId: access.context.user.id }, branchId }, { headers: { "Cache-Control": "no-store" } });}
