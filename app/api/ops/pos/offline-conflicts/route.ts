import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { branches, inventoryItems, inventoryWarehouses, invoices, offlineStockConflicts } from "@/lib/db/schema";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { resolveOfflineConflict } from "@/lib/operations/offline-conflicts";
import { uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (branchId) await requireBranchMembership(access.context, branchId);
  const filters = [eq(offlineStockConflicts.tenantId, access.context.tenantId), isNull(offlineStockConflicts.acknowledgedAt)];
  if (branchId) filters.push(eq(offlineStockConflicts.branchId, branchId));
  const rows = await access.context.db.select({
    id: offlineStockConflicts.id,
    branchId: offlineStockConflicts.branchId,
    branchName: branches.name, branchNameAr: branches.nameAr, branchNameEn: branches.nameEn,
    invoiceId: offlineStockConflicts.invoiceId,
    invoiceNumber: invoices.invoiceNumber,
    localInvoiceNumber: invoices.offlineLocalNumber,
    invoicePaidMinor: invoices.paidMinor,
    invoiceCurrency: invoices.currency,
    itemId: offlineStockConflicts.itemId,
    warehouseId: offlineStockConflicts.warehouseId,
    itemName: inventoryItems.name,
    sku: inventoryItems.sku,
    warehouseName: inventoryWarehouses.name,
    requestedQuantity: offlineStockConflicts.requestedQuantity,
    availableQuantity: offlineStockConflicts.availableQuantity,
    shortageQuantity: offlineStockConflicts.shortageQuantity,
    quantityScale: offlineStockConflicts.quantityScale,
    resolution: offlineStockConflicts.resolution,
    replacementQuantity: offlineStockConflicts.replacementQuantity,
    replacementWarehouseId: offlineStockConflicts.replacementWarehouseId,
    resolutionNote: offlineStockConflicts.resolutionNote,
    resolvedAt: offlineStockConflicts.resolvedAt,
    resolvedBy: offlineStockConflicts.resolvedBy,
    createdAt: offlineStockConflicts.createdAt,
  }).from(offlineStockConflicts)
    .innerJoin(branches, and(eq(branches.id, offlineStockConflicts.branchId), eq(branches.tenantId, offlineStockConflicts.tenantId)))
    .innerJoin(invoices, and(eq(invoices.id, offlineStockConflicts.invoiceId), eq(invoices.tenantId, offlineStockConflicts.tenantId)))
    .innerJoin(inventoryItems, and(eq(inventoryItems.id, offlineStockConflicts.itemId), eq(inventoryItems.tenantId, offlineStockConflicts.tenantId)))
    .innerJoin(inventoryWarehouses, and(eq(inventoryWarehouses.id, offlineStockConflicts.warehouseId), eq(inventoryWarehouses.tenantId, offlineStockConflicts.tenantId)))
    .where(and(...filters)).orderBy(desc(offlineStockConflicts.createdAt)).limit(100);
  const warehouses = branchId ? await access.context.db.select({ id: inventoryWarehouses.id, name: inventoryWarehouses.name }).from(inventoryWarehouses)
    .where(and(eq(inventoryWarehouses.tenantId, access.context.tenantId), eq(inventoryWarehouses.isActive, true), or(eq(inventoryWarehouses.branchId, branchId), isNull(inventoryWarehouses.branchId))))
    .orderBy(inventoryWarehouses.name) : [];
  return Response.json({ conflicts: rows, warehouses }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = z.object({ id: uuidSchema, action: z.enum(["retry", "edit", "cancel", "reallocate"]), idempotencyKey: z.string().trim().min(8).max(120), replacementQuantity: z.number().int().positive().optional(), replacementWarehouseId: uuidSchema.optional(), refundReference: z.string().trim().min(3).max(120).optional(), refundCompleted: z.boolean().optional(), note: z.string().trim().max(500).nullable().optional() }).safeParse(await request.json());
    if (!parsed.success) throw new ApiError("قرار معالجة تعارض الأوفلاين غير صالح");
    const input = parsed.data;
    const [conflict] = await access.context.db.select({ id: offlineStockConflicts.id, branchId: offlineStockConflicts.branchId, warehouseId: offlineStockConflicts.warehouseId, resolution: offlineStockConflicts.resolution })
      .from(offlineStockConflicts)
      .where(and(eq(offlineStockConflicts.id, input.id), eq(offlineStockConflicts.tenantId, access.context.tenantId)))
      .limit(1);
    if (!conflict) throw new ApiError("تنبيه العجز غير موجود", 404);
    await requireBranchMembership(access.context, conflict.branchId);
    const originalWarehouse = await access.context.db.select({ id: inventoryWarehouses.id, branchId: inventoryWarehouses.branchId, isActive: inventoryWarehouses.isActive })
      .from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, conflict.warehouseId), eq(inventoryWarehouses.tenantId, access.context.tenantId))).limit(1);
    if (!originalWarehouse[0]?.isActive) throw new ApiError("المخزن الأصلي غير موجود أو غير نشط", 409);
    await requireWarehouseBranchMembership(access.context, originalWarehouse[0].branchId);
    if (input.action === "reallocate") {
      if (!input.replacementWarehouseId) throw new ApiError("المخزن البديل مطلوب لإعادة التخصيص");
      const replacementWarehouse = await access.context.db.select({ id: inventoryWarehouses.id, branchId: inventoryWarehouses.branchId, isActive: inventoryWarehouses.isActive })
        .from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, input.replacementWarehouseId), eq(inventoryWarehouses.tenantId, access.context.tenantId))).limit(1);
      if (!replacementWarehouse[0]?.isActive || (replacementWarehouse[0].branchId !== null && replacementWarehouse[0].branchId !== conflict.branchId)) throw new ApiError("المخزن البديل غير متاح لهذا الفرع أو غير نشط", 409);
      await requireWarehouseBranchMembership(access.context, replacementWarehouse[0].branchId);
    }
    if ((input.action === "edit" || input.action === "reallocate") && !input.replacementQuantity) throw new ApiError("الكمية البديلة مطلوبة لهذا القرار");
    const payload = { id: input.id, action: input.action, idempotencyKey: input.idempotencyKey, replacementQuantity: input.replacementQuantity ?? null, replacementWarehouseId: input.replacementWarehouseId ?? null, refundReference: input.refundReference?.trim() || null, refundCompleted: input.refundCompleted === true, note: input.note?.trim() || null };
    const result = await resolveOfflineConflict(access.context.env.DB, {
      tenantId: access.context.tenantId,
      actorId: access.context.user.id,
      conflictId: input.id,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      payloadHash: await payloadFingerprint(payload),
      payloadJson: JSON.stringify(payload),
      replacementQuantity: input.replacementQuantity,
      replacementWarehouseId: input.replacementWarehouseId,
      refundReference: input.refundReference?.trim(),
      refundCompleted: input.refundCompleted,
      note: input.note?.trim() || null,
    });
    if (!result.replayed) await writeAudit(access.context, request, "inventory.offline_stock_conflict_resolved", "offline_stock_conflict", conflict.id, { action: input.action, actionId: result.actionId, result: result.result });
    return Response.json({ acknowledged: true, resolution: result.action, actionId: result.actionId, replayed: result.replayed, result: result.result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
