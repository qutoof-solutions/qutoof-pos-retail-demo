import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { branches, distributionRoutes, distributionTripInvoices, distributionTripLines, distributionTrips, inventoryBalances, inventoryItems, inventoryWarehouses, invoicePayments, salesReps, stockMovements, stockOperations } from "@/lib/db/schema";
import { allocateStock, quantityToUnits, type InventoryItemRow } from "@/lib/operations/inventory";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const loadSchema = z.object({ itemId: uuidSchema, quantity: z.number().finite().gt(0).max(1_000_000) });
const startSchema = z.object({ branchId: uuidSchema, routeId: uuidSchema, salesRepId: uuidSchema, sourceWarehouseId: uuidSchema, lines: z.array(loadSchema).min(1).max(15), notes: z.string().trim().max(500).nullable().optional() }).superRefine((value, context) => {
  if (new Set(value.lines.map((line) => line.itemId)).size !== value.lines.length) context.addIssue({ code: "custom", path: ["lines"], message: "لا تكرر الصنف في إذن التحميل" });
});

type TripLineRow = { id: string; itemId: string; itemName: string; sku: string; unitCode: string; quantityScale: number; batchId: string | null; batchKey: string; loadedUnits: number; soldUnits: number; returnedGoodUnits: number; returnedDamagedUnits: number; missingUnits: number; unitCostMinor: number };

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper", "reception"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  try {
    if (branchId) await requireBranchMembership(access.context, branchId);
    const requestedStatus = new URL(request.url).searchParams.get("status");
    const filters = [eq(distributionTrips.tenantId, access.context.tenantId)];
    if (requestedStatus === "open" || requestedStatus === "settled") filters.push(eq(distributionTrips.status, requestedStatus));
    if (branchId) filters.push(eq(distributionTrips.branchId, branchId));
    const rows = await access.context.db.select({ id: distributionTrips.id, tripNumber: distributionTrips.tripNumber, branchId: distributionTrips.branchId, routeId: distributionTrips.routeId, routeName: distributionTrips.routeNameSnapshot, fallbackRouteName: distributionRoutes.name, salesRepId: distributionTrips.salesRepId, salesRepName: distributionTrips.salesRepNameSnapshot, fallbackSalesRepName: salesReps.fullName, vehicleName: distributionTrips.vehicleNameSnapshot, vehiclePlate: distributionTrips.vehiclePlateSnapshot, status: distributionTrips.status, closedAt: distributionTrips.closedAt, expectedCashMinor: distributionTrips.expectedCashMinor, handedCashMinor: distributionTrips.handedCashMinor, cashDifferenceMinor: distributionTrips.cashDifferenceMinor, sourceWarehouseId: distributionTrips.sourceWarehouseId, vanWarehouseId: distributionTrips.vanWarehouseId, openedAt: distributionTrips.openedAt, notes: distributionTrips.notes }).from(distributionTrips).innerJoin(distributionRoutes, and(eq(distributionRoutes.id, distributionTrips.routeId), eq(distributionRoutes.tenantId, access.context.tenantId))).innerJoin(salesReps, and(eq(salesReps.id, distributionTrips.salesRepId), eq(salesReps.tenantId, access.context.tenantId))).where(and(...filters)).orderBy(desc(distributionTrips.createdAt)).limit(50);
    const tripIds = rows.map((row) => row.id);
    const lines: Array<Omit<TripLineRow, "soldUnits"> & { tripId: string }> = tripIds.length ? await access.context.db.select({ id: distributionTripLines.id, tripId: distributionTripLines.tripId, itemId: distributionTripLines.itemId, itemName: inventoryItems.name, sku: inventoryItems.sku, unitCode: inventoryItems.unitCode, quantityScale: distributionTripLines.quantityScale, batchId: distributionTripLines.batchId, batchKey: distributionTripLines.batchKey, loadedUnits: distributionTripLines.loadedUnits, returnedGoodUnits: distributionTripLines.returnedGoodUnits, returnedDamagedUnits: distributionTripLines.returnedDamagedUnits, missingUnits: distributionTripLines.missingUnits, unitCostMinor: distributionTripLines.unitCostMinor }).from(distributionTripLines).innerJoin(inventoryItems, and(eq(inventoryItems.id, distributionTripLines.itemId), eq(inventoryItems.tenantId, access.context.tenantId))).where(and(eq(distributionTripLines.tenantId, access.context.tenantId), inArray(distributionTripLines.tripId, tripIds))).orderBy(inventoryItems.name) : [];
    const soldRows = tripIds.length ? await access.context.env.DB.prepare(`SELECT dti.trip_id AS tripId, m.item_id AS itemId, COALESCE(m.batch_id, '') AS batchKey, SUM(-m.quantity_delta) AS soldUnits FROM distribution_trip_invoices dti JOIN distribution_trips t ON t.id = dti.trip_id AND t.tenant_id = dti.tenant_id JOIN stock_movements m ON m.tenant_id = dti.tenant_id AND m.reference_type = 'invoice' AND m.reference_id = dti.invoice_id AND m.warehouse_id = t.van_warehouse_id WHERE dti.tenant_id = ? AND dti.trip_id IN (${tripIds.map(() => "?").join(",")}) AND m.movement_type = 'pos_deduction' GROUP BY dti.trip_id, m.item_id, COALESCE(m.batch_id, '')`).bind(access.context.tenantId, ...tripIds).all<{ tripId: string; itemId: string; batchKey: string; soldUnits: number }>() : { results: [] as Array<{ tripId: string; itemId: string; batchKey: string; soldUnits: number }> };
    const cashRows = tripIds.length ? await access.context.db.select({ tripId: distributionTripInvoices.tripId, amountMinor: invoicePayments.amountMinor }).from(distributionTripInvoices).innerJoin(invoicePayments, and(eq(invoicePayments.invoiceId, distributionTripInvoices.invoiceId), eq(invoicePayments.tenantId, distributionTripInvoices.tenantId))).where(and(eq(distributionTripInvoices.tenantId, access.context.tenantId), inArray(distributionTripInvoices.tripId, tripIds), eq(invoicePayments.paymentMethod, "cash"), isNull(invoicePayments.reversedAt))) : [];
    const soldByKey = new Map(soldRows.results.map((item) => [`${item.tripId}:${item.itemId}:${item.batchKey}`, item.soldUnits]));
    const cashByTrip = new Map<string, number>();
    for (const row of cashRows) cashByTrip.set(row.tripId, (cashByTrip.get(row.tripId) ?? 0) + row.amountMinor);
    return Response.json({ trips: rows.map((trip) => ({ ...trip, routeName: trip.routeName ?? trip.fallbackRouteName, salesRepName: trip.salesRepName ?? trip.fallbackSalesRepName, expectedCashMinor: trip.status === "open" ? (cashByTrip.get(trip.id) ?? 0) : trip.expectedCashMinor, lines: lines.filter((line) => line.tripId === trip.id).map((line) => ({ ...line, soldUnits: soldByKey.get(`${trip.id}:${line.itemId}:${line.batchKey}`) ?? 0 })) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر تحميل الرحلات المفتوحة"); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const parsed = startSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات إذن التحميل والكميات");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    await requireWarehouseBranchMembership(access.context, input.branchId);
    const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
    const [route] = await access.context.db.select().from(distributionRoutes).where(and(eq(distributionRoutes.id, input.routeId), eq(distributionRoutes.tenantId, access.context.tenantId), eq(distributionRoutes.branchId, input.branchId), eq(distributionRoutes.isActive, true))).limit(1);
    const [rep] = await access.context.db.select().from(salesReps).where(and(eq(salesReps.id, input.salesRepId), eq(salesReps.tenantId, access.context.tenantId), eq(salesReps.branchId, input.branchId), eq(salesReps.isActive, true))).limit(1);
    const [source] = await access.context.db.select().from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, input.sourceWarehouseId), eq(inventoryWarehouses.tenantId, access.context.tenantId), eq(inventoryWarehouses.isActive, true))).limit(1);
    if (!branch || !route || !rep || !source || !rep.vanWarehouseId) throw new ApiError("الفرع أو خط السير أو المندوب أو مخزن المصدر غير صالح", 404);
    if (rep.routeId && rep.routeId !== route.id) throw new ApiError("خط السير لا يطابق خط المندوب", 409);
    if (source.branchId && source.branchId !== input.branchId) throw new ApiError("مخزن التحميل لا يتبع الفرع المحدد", 409);
    await requireWarehouseBranchMembership(access.context, source.branchId);
    if (source.id === rep.vanWarehouseId) throw new ApiError("اختر مخزنًا رئيسيًا مختلفًا عن مخزن السيارة", 400);
    const [openTrip] = await access.context.db.select({ id: distributionTrips.id }).from(distributionTrips).where(and(eq(distributionTrips.tenantId, access.context.tenantId), eq(distributionTrips.salesRepId, rep.id), eq(distributionTrips.status, "open"))).limit(1);
    if (openTrip) throw new ApiError("لدى المندوب رحلة مفتوحة بالفعل؛ سوِّ عهدتها أولاً", 409);
    const nonzero = await access.context.env.DB.prepare("SELECT COALESCE(SUM(quantity_on_hand), 0) AS quantity FROM inventory_balances WHERE tenant_id = ? AND warehouse_id = ? AND quantity_on_hand <> 0").bind(access.context.tenantId, rep.vanWarehouseId).first<{ quantity: number }>();
    if ((nonzero?.quantity ?? 0) !== 0) throw new ApiError("مخزن السيارة يحتوي رصيدًا متبقيًا من رحلة سابقة؛ طابق الرصيد قبل فتح رحلة جديدة", 409);
    const loaded: Array<{ item: InventoryItemRow; allocation: Awaited<ReturnType<typeof allocateStock>>[number] }> = [];
    for (const requested of input.lines) {
      const product = await access.context.env.DB.prepare("SELECT id, tenant_id, sku, name, unit_code, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor FROM inventory_items WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(requested.itemId, access.context.tenantId).first<InventoryItemRow>();
      if (!product) throw new ApiError("أحد الأصناف غير موجود أو غير نشط", 404);
      const quantity = quantityToUnits(requested.quantity, product.quantity_scale);
      const allocations = await allocateStock(access.context.env.DB, { tenantId: access.context.tenantId, item: product, warehouseId: source.id, quantity });
      for (const allocation of allocations) loaded.push({ item: product, allocation });
      if (loaded.length > 12) throw new ApiError("عدد دفعات التحميل كبير؛ قسّم الكميات على إذنين لتفادي تجاوز حد المعاملة", 400);
    }
    const now = new Date();
    const tripId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const tripNumber = `TR-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${tripId.slice(0, 8).toUpperCase()}`;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      access.context.db.insert(distributionTrips).values({ id: tripId, tenantId: access.context.tenantId, branchId: input.branchId, routeId: route.id, routeNameSnapshot: route.name, salesRepId: rep.id, salesRepNameSnapshot: rep.fullName, vehicleNameSnapshot: rep.vehicleName, vehiclePlateSnapshot: rep.vehiclePlate, sourceWarehouseId: source.id, vanWarehouseId: rep.vanWarehouseId, tripNumber, status: "open", notes: input.notes ?? null, openedBy: access.context.user.id, openedAt: now, createdAt: now, updatedAt: now }),
      access.context.db.insert(stockOperations).values({ id: operationId, tenantId: access.context.tenantId, operationType: "transfer", idempotencyKey: `distribution-load:${tripId}`, referenceType: "distribution_trip_load", referenceId: tripId, createdBy: access.context.user.id, notes: `تحميل عهدة ${rep.fullName} · ${tripNumber}`, metadataJson: JSON.stringify({ sourceWarehouseId: source.id, vanWarehouseId: rep.vanWarehouseId, allocationCount: loaded.length }), createdAt: now }),
    ];
    for (const { item, allocation } of loaded) {
      const lineId = crypto.randomUUID();
      statements.push(access.context.db.insert(distributionTripLines).values({ id: lineId, tenantId: access.context.tenantId, tripId, itemId: item.id, batchId: allocation.batchId, batchKey: allocation.batchId ?? "", quantityScale: item.quantity_scale, loadedUnits: allocation.quantity, unitCostMinor: allocation.unitCostMinor, createdAt: now }));
      statements.push(access.context.db.insert(inventoryBalances).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: item.id, warehouseId: source.id, batchId: allocation.batchId, batchKey: allocation.batchId ?? "", quantityOnHand: 0, updatedAt: now }).onConflictDoNothing());
      statements.push(access.context.db.insert(inventoryBalances).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: item.id, warehouseId: rep.vanWarehouseId, batchId: allocation.batchId, batchKey: allocation.batchId ?? "", quantityOnHand: 0, updatedAt: now }).onConflictDoNothing());
      for (const movement of [
        { warehouseId: source.id, delta: -allocation.quantity, type: "transfer_out" as const },
        { warehouseId: rep.vanWarehouseId, delta: allocation.quantity, type: "transfer_in" as const },
      ]) statements.push(access.context.db.insert(stockMovements).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, operationId, itemId: item.id, warehouseId: movement.warehouseId, batchId: allocation.batchId, movementType: movement.type, quantityDelta: movement.delta, unitCostMinor: allocation.unitCostMinor, referenceType: "distribution_trip_load", referenceId: tripId, note: `إذن تحميل ${tripNumber}`, createdBy: access.context.user.id, createdAt: now }));
    }
    await access.context.db.batch(statements);
    await writeAudit(access.context, request, "distribution.trip.opened", "distribution_trip", tripId, { tripNumber, salesRepId: rep.id, routeId: route.id, loadedLineCount: loaded.length });
    return Response.json({ trip: { id: tripId, tripNumber, status: "open", branchId: input.branchId, routeId: route.id, routeName: route.name, salesRepId: rep.id, salesRepName: rep.fullName, sourceWarehouseId: source.id, vanWarehouseId: rep.vanWarehouseId, openedAt: now, lines: loaded.map(({ item, allocation }) => ({ itemId: item.id, itemName: item.name, unitCode: item.unit_code, quantityScale: item.quantity_scale, batchId: allocation.batchId, loadedUnits: allocation.quantity, unitCostMinor: allocation.unitCostMinor })) } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("distribution_trips_one_open_rep_uq")) return Response.json({ error: "لدى المندوب رحلة مفتوحة بالفعل؛ سوِّ عهدتها أولاً" }, { status: 409 });
    if (String(error).includes("INVENTORY_NEGATIVE_STOCK") || String(error).includes("INVENTORY_INSUFFICIENT")) return Response.json({ error: "تغير رصيد المخزن أثناء التحميل؛ حدّث الأرصدة وأعد المحاولة" }, { status: 409 });
    return errorResponse(error, "تعذر فتح رحلة التوزيع");
  }
}
