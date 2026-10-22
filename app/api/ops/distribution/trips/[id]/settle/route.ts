import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { distributionTripInvoices, distributionTripLines, distributionTrips, inventoryBalances, invoicePayments, stockMovements, stockOperations, treasuryAccounts, treasuryTransactions } from "@/lib/db/schema";
import { cashDifference, validateTripSettlement } from "@/lib/operations/distribution-finance";
import { unitsToQuantity } from "@/lib/operations/inventory";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const settlementSchema = z.object({ handedCash: moneySchema.max(100_000_000), cashAccountId: uuidSchema.nullable().optional(), notes: z.string().trim().max(500).nullable().optional(), lines: z.array(z.object({ lineId: uuidSchema, returnedGood: z.number().finite().min(0), returnedDamaged: z.number().finite().min(0), missing: z.number().finite().min(0) })).min(1).max(20) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("معرف الرحلة غير صالح");
    const parsed = settlementSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات تسوية الرحلة");
    const input = parsed.data;
    const [trip] = await access.context.db.select().from(distributionTrips).where(and(eq(distributionTrips.id, id), eq(distributionTrips.tenantId, access.context.tenantId))).limit(1);
    if (!trip) throw new ApiError("الرحلة غير موجودة", 404);
    if (trip.status !== "open") throw new ApiError("تمت تسوية هذه الرحلة بالفعل", 409);
    await requireBranchMembership(access.context, trip.branchId);
    const lines = await access.context.db.select().from(distributionTripLines).where(and(eq(distributionTripLines.tenantId, access.context.tenantId), eq(distributionTripLines.tripId, trip.id)));
    if (!lines.length || input.lines.length !== lines.length || new Set(input.lines.map((line) => line.lineId)).size !== lines.length) throw new ApiError("يجب إرسال سطر تسوية واحد فقط لكل صنف/دفعة محملة", 409);
    const supplied = new Map(input.lines.map((line) => [line.lineId, line]));
    const tripInvoiceRows = await access.context.db.select({ invoiceId: distributionTripInvoices.invoiceId }).from(distributionTripInvoices).where(and(eq(distributionTripInvoices.tenantId, access.context.tenantId), eq(distributionTripInvoices.tripId, trip.id)));
    const invoiceIds = tripInvoiceRows.map((row) => row.invoiceId);
    const soldRows = invoiceIds.length ? await access.context.env.DB.prepare(`SELECT m.item_id AS itemId, COALESCE(m.batch_id, '') AS batchKey, SUM(-m.quantity_delta) AS soldUnits FROM stock_movements m WHERE m.tenant_id = ? AND m.warehouse_id = ? AND m.reference_type = 'invoice' AND m.reference_id IN (${invoiceIds.map(() => "?").join(",")}) AND m.movement_type = 'pos_deduction' GROUP BY m.item_id, COALESCE(m.batch_id, '')`).bind(access.context.tenantId, trip.vanWarehouseId, ...invoiceIds).all<{ itemId: string; batchKey: string; soldUnits: number }>() : { results: [] as Array<{ itemId: string; batchKey: string; soldUnits: number }> };
    const soldByKey = new Map(soldRows.results.map((row) => [`${row.itemId}:${row.batchKey}`, row.soldUnits]));
    const settlementLines = lines.map((line) => {
      const submitted = supplied.get(line.id);
      if (!submitted) throw new ApiError("يوجد سطر محمل بلا تسوية", 409);
      const factor = 10 ** line.quantityScale;
      const returnGood = Math.round(submitted.returnedGood * factor);
      const returnDamaged = Math.round(submitted.returnedDamaged * factor);
      const missing = Math.round(submitted.missing * factor);
      if ([submitted.returnedGood, submitted.returnedDamaged, submitted.missing].some((value) => Math.abs(value * factor - Math.round(value * factor)) > 1e-8)) throw new ApiError("أحد المرتجعات لا يطابق دقة وحدة الصنف", 400);
      const soldUnits = soldByKey.get(`${line.itemId}:${line.batchKey}`) ?? 0;
      try { validateTripSettlement({ loadedUnits: line.loadedUnits, soldUnits, returnedGoodUnits: returnGood, returnedDamagedUnits: returnDamaged, missingUnits: missing }); }
      catch (error) { throw new ApiError(error instanceof Error ? error.message : "تسوية الكمية غير متوازنة", 409); }
      return { line, soldUnits, returnGood, returnDamaged, missing };
    });
    const vanBalances = await access.context.db.select({ itemId: inventoryBalances.itemId, batchKey: inventoryBalances.batchKey, quantity: inventoryBalances.quantityOnHand }).from(inventoryBalances).where(and(eq(inventoryBalances.tenantId, access.context.tenantId), eq(inventoryBalances.warehouseId, trip.vanWarehouseId), inArray(inventoryBalances.itemId, [...new Set(lines.map((line) => line.itemId))])));
    const balanceByKey = new Map(vanBalances.map((balance) => [`${balance.itemId}:${balance.batchKey}`, balance.quantity]));
    for (const row of settlementLines) {
      const remainingOnVan = row.line.loadedUnits - row.soldUnits;
      if ((balanceByKey.get(`${row.line.itemId}:${row.line.batchKey}`) ?? 0) !== remainingOnVan) throw new ApiError("رصيد مخزن السيارة لا يطابق حركة الفواتير؛ راجع الحركات أو صححها قبل إقفال العهدة", 409);
    }
    const cashRows = invoiceIds.length ? await access.context.db.select({ amountMinor: invoicePayments.amountMinor }).from(invoicePayments).innerJoin(distributionTripInvoices, and(eq(distributionTripInvoices.invoiceId, invoicePayments.invoiceId), eq(distributionTripInvoices.tenantId, invoicePayments.tenantId))).where(and(eq(invoicePayments.tenantId, access.context.tenantId), eq(distributionTripInvoices.tripId, trip.id), eq(invoicePayments.paymentMethod, "cash"), isNull(invoicePayments.reversedAt))) : [];
    const expectedCashMinor = cashRows.reduce((sum, row) => sum + row.amountMinor, 0);
    const handedCashMinor = Math.round(input.handedCash * 100);
    const cashDifferenceMinor = cashDifference(expectedCashMinor, handedCashMinor);
    let cashAccount: typeof treasuryAccounts.$inferSelect | null = null;
    if (handedCashMinor > 0) {
      if (!input.cashAccountId) throw new ApiError("حدد الخزنة أو الحساب البنكي الذي أودع فيه النقد المسلم", 400);
      const [account] = await access.context.db.select().from(treasuryAccounts).where(and(eq(treasuryAccounts.id, input.cashAccountId), eq(treasuryAccounts.tenantId, access.context.tenantId), eq(treasuryAccounts.isActive, true))).limit(1);
      if (!account || (account.branchId && account.branchId !== trip.branchId) || account.currency !== "EGP") throw new ApiError("حساب الإيداع غير متاح لهذا الفرع أو العملة", 409);
      cashAccount = account;
    }
    const now = new Date();
    const operationId = crypto.randomUUID();
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [access.context.db.insert(stockOperations).values({ id: operationId, tenantId: access.context.tenantId, operationType: "transfer", idempotencyKey: `distribution-settlement:${trip.id}`, referenceType: "distribution_trip_settlement", referenceId: trip.id, createdBy: access.context.user.id, notes: `تسوية عهدة الرحلة ${trip.tripNumber}`, metadataJson: JSON.stringify({ expectedCashMinor, handedCashMinor, cashDifferenceMinor, lineCount: settlementLines.length }), createdAt: now })];
    for (const row of settlementLines) {
      statements.push(access.context.db.update(distributionTripLines).set({ returnedGoodUnits: row.returnGood, returnedDamagedUnits: row.returnDamaged, missingUnits: row.missing }).where(and(eq(distributionTripLines.id, row.line.id), eq(distributionTripLines.tenantId, access.context.tenantId), eq(distributionTripLines.tripId, trip.id))));
      if (row.returnGood > 0) {
        statements.push(access.context.db.insert(inventoryBalances).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: row.line.itemId, warehouseId: trip.sourceWarehouseId, batchId: row.line.batchId, batchKey: row.line.batchKey, quantityOnHand: 0, updatedAt: now }).onConflictDoNothing());
        statements.push(access.context.db.insert(inventoryBalances).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: row.line.itemId, warehouseId: trip.vanWarehouseId, batchId: row.line.batchId, batchKey: row.line.batchKey, quantityOnHand: 0, updatedAt: now }).onConflictDoNothing());
        statements.push(access.context.db.insert(stockMovements).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, operationId, itemId: row.line.itemId, warehouseId: trip.vanWarehouseId, batchId: row.line.batchId, movementType: "transfer_out", quantityDelta: -row.returnGood, unitCostMinor: row.line.unitCostMinor, referenceType: "distribution_trip_settlement", referenceId: trip.id, note: "إرجاع سليم من عهدة السيارة", createdBy: access.context.user.id, createdAt: now }));
        statements.push(access.context.db.insert(stockMovements).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, operationId, itemId: row.line.itemId, warehouseId: trip.sourceWarehouseId, batchId: row.line.batchId, movementType: "transfer_in", quantityDelta: row.returnGood, unitCostMinor: row.line.unitCostMinor, referenceType: "distribution_trip_settlement", referenceId: trip.id, note: "إرجاع سليم إلى المخزن الرئيسي", createdBy: access.context.user.id, createdAt: now }));
      }
      if (row.returnDamaged + row.missing > 0) {
        statements.push(access.context.db.insert(stockMovements).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, operationId, itemId: row.line.itemId, warehouseId: trip.vanWarehouseId, batchId: row.line.batchId, movementType: "stock_out", quantityDelta: -(row.returnDamaged + row.missing), unitCostMinor: row.line.unitCostMinor, referenceType: "distribution_trip_settlement", referenceId: trip.id, note: `تالف ${row.returnDamaged} وحدة؛ عجز ${row.missing} وحدة`, createdBy: access.context.user.id, createdAt: now }));
      }
    }
    if (cashAccount) statements.push(access.context.db.insert(treasuryTransactions).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, accountId: cashAccount.id, branchId: trip.branchId, routeId: trip.routeId, salesRepId: trip.salesRepId, tripId: trip.id, direction: "in", category: "customer_receipt", isOperatingExpense: false, amountMinor: handedCashMinor, currency: cashAccount.currency, description: `نقدية مسلمة عند تسوية الرحلة ${trip.tripNumber}`, reference: trip.tripNumber, idempotencyKey: `trip-cash:${trip.id}`, createdBy: access.context.user.id, createdAt: now }));
    statements.push(access.context.db.update(distributionTrips).set({ status: "settled", closedBy: access.context.user.id, closedAt: now, expectedCashMinor, handedCashMinor, cashDifferenceMinor, updatedAt: now }).where(and(eq(distributionTrips.id, trip.id), eq(distributionTrips.tenantId, access.context.tenantId), eq(distributionTrips.status, "open"))));
    await access.context.db.batch(statements);
    await writeAudit(access.context, request, "distribution.trip.settled", "distribution_trip", trip.id, { expectedCashMinor, handedCashMinor, cashDifferenceMinor, lineCount: settlementLines.length });
    return Response.json({ settlement: { tripId: trip.id, tripNumber: trip.tripNumber, expectedCashMinor, handedCashMinor, cashDifferenceMinor, lines: settlementLines.map((row) => ({ itemId: row.line.itemId, loadedUnits: row.line.loadedUnits, soldUnits: row.soldUnits, returnedGoodUnits: row.returnGood, returnedDamagedUnits: row.returnDamaged, missingUnits: row.missing, quantityScale: row.line.quantityScale, soldQuantity: unitsToQuantity(row.soldUnits, row.line.quantityScale) })) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("TREASURY_INSUFFICIENT_FUNDS")) return Response.json({ error: "رصيد الحساب لا يكفي لإثبات سند القبض؛ راجع رصيد الخزنة" }, { status: 409 });
    if (String(error).includes("INVENTORY_NEGATIVE_STOCK")) return Response.json({ error: "تغير رصيد مخزن السيارة بالتزامن؛ أعد تحميل الرحلة قبل التسوية" }, { status: 409 });
    return errorResponse(error, "تعذر تسوية عهدة الرحلة");
  }
}
