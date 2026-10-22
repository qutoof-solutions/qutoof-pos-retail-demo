import { z } from "zod";
import { uuidSchema } from "@/lib/operations/validation";
import { allocateStock, createBalanceStatement, createBalanceStatementByLot, getExistingOperation, getOperationMovements, quantityToUnits, type InventoryItemRow, type StockAllocation } from "@/lib/operations/inventory";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { getAccessibleWarehouseIds, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const inputSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(120), type: z.enum(["stock_out", "transfer", "adjustment"]), sourceWarehouseId: uuidSchema, targetWarehouseId: uuidSchema.nullable().optional(), notes: z.string().trim().max(500).nullable().optional(), lines: z.array(z.object({ itemId: uuidSchema, unitId: uuidSchema.optional(), quantity: z.number().finite().gt(0).max(1_000_000), direction: z.enum(["increase", "decrease"]).optional(), batchId: uuidSchema.nullable().optional(), lotNumber: z.string().trim().max(80).nullable().optional(), expiresOn: z.string().date().nullable().optional() })).min(1).max(18) }).refine((input) => input.type !== "transfer" || (input.targetWarehouseId && input.targetWarehouseId !== input.sourceWarehouseId), "حدد مخزناً مستهدفاً مختلفاً للتحويل").refine((input) => input.type === "transfer" || !input.targetWarehouseId, "المخزن المستهدف خاص بعملية النقل").refine((input) => input.type !== "adjustment" || input.lines.every((line) => line.direction), "حدد زيادة أو خفضاً في التسوية");

type PlannedMovement = { item: InventoryItemRow; unitId: string | null; unitQuantity: number; unitCode: string; unitConversionFactor: number; batchId: string | null; batchLotNumber: string | null; warehouseId: string; movementType: string; quantityDelta: number; unitCostMinor: number; note: string };

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ movements: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const result = await d1.prepare(`SELECT m.id, m.operation_id AS operationId, o.operation_type AS operationType, m.movement_type AS movementType, m.item_id AS itemId, i.name AS itemName, i.sku, m.warehouse_id AS warehouseId, w.name AS warehouseName, m.batch_id AS batchId, b.lot_number AS lotNumber, b.expires_on AS expiresOn, m.quantity_delta AS quantityDelta, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, m.unit_cost_minor AS unitCostMinor, m.reference_type AS referenceType, m.reference_id AS referenceId, m.note, m.created_at AS createdAt, u.full_name AS createdBy FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id JOIN inventory_warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id JOIN stock_operations o ON o.id = m.operation_id AND o.tenant_id = m.tenant_id LEFT JOIN inventory_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id LEFT JOIN users u ON u.id = m.created_by AND u.tenant_id = m.tenant_id WHERE m.tenant_id = ? AND m.warehouse_id IN (${placeholders}) ORDER BY m.created_at DESC, m.id DESC LIMIT 250`).bind(access.context.tenantId, ...warehouseIds).all();
  return Response.json({ movements: result.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  let requestKey = "";
  let requestOperationType = "";
  let requestHash = "";
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من نوع الحركة والمخازن والكميات");
    const input = parsed.data;
    const sourceWarehouse = await d1.prepare("SELECT id, branch_id AS branchId FROM inventory_warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.sourceWarehouseId, access.context.tenantId).first<{ id: string; branchId: string | null }>();
    if (!sourceWarehouse) throw new ApiError("المخزن الأصلي غير موجود أو غير نشط", 404);
    await requireWarehouseBranchMembership(access.context, sourceWarehouse.branchId);
    if (input.type === "transfer") {
      const targetWarehouse = await d1.prepare("SELECT id, branch_id AS branchId FROM inventory_warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.targetWarehouseId!, access.context.tenantId).first<{ id: string; branchId: string | null }>();
      if (!targetWarehouse) throw new ApiError("المخزن المستهدف غير موجود أو غير نشط", 404);
      await requireWarehouseBranchMembership(access.context, targetWarehouse.branchId);
    }
    requestKey = input.idempotencyKey;
    const type = input.type;
    const operationType = type === "transfer" ? "transfer" : type === "adjustment" ? "adjustment" : "stock_out";
    requestOperationType = operationType;
    requestHash = await payloadFingerprint({
      type,
      sourceWarehouseId: input.sourceWarehouseId,
      targetWarehouseId: input.targetWarehouseId ?? null,
      notes: input.notes ?? null,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        direction: type === "adjustment" ? line.direction ?? null : null,
        batchId: line.batchId ?? null,
        lotNumber: line.lotNumber ?? null,
        expiresOn: line.expiresOn ?? null,
      })),
    });
    const prior = await getExistingOperation(d1, access.context.tenantId, requestKey);
    if (prior) {
      if (prior.operation_type !== operationType) throw new ApiError("مفتاح العملية استُخدم لنوع آخر", 409);
      let priorHash: string | null = null;
      try { priorHash = JSON.parse(prior.metadata_json)?.payloadHash ?? null; } catch { /* unverifiable legacy payloads must conflict */ }
      if (priorHash !== requestHash) throw new ApiError("مفتاح العملية مستخدم لطلب مختلف؛ أنشئ مفتاحاً جديداً", 409);
      return Response.json({ movements: await getOperationMovements(d1, access.context.tenantId, prior.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const source = await d1.prepare("SELECT id FROM inventory_warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.sourceWarehouseId, access.context.tenantId).first();
    if (!source) throw new ApiError("المخزن الأصلي غير موجود أو غير نشط", 404);
    if (type === "transfer") {
      const target = await d1.prepare("SELECT id FROM inventory_warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.targetWarehouseId!, access.context.tenantId).first();
      if (!target) throw new ApiError("المخزن المستهدف غير موجود أو غير نشط", 404);
    }
    const operationId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const planned: PlannedMovement[] = [];
    const newBatches = new Map<string, { id: string; itemId: string; lotNumber: string; expiresOn: string | null; insert: boolean }>();
    for (const line of input.lines) {
      const item = await d1.prepare("SELECT id, tenant_id, sku, name, unit_code, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor FROM inventory_items WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(line.itemId, access.context.tenantId).first<InventoryItemRow>();
      if (!item) throw new ApiError("أحد الأصناف غير موجود أو غير نشط", 404);
      const unit = line.unitId ? await d1.prepare("SELECT id, code, conversion_factor AS conversionFactor, is_active AS isActive FROM inventory_item_units WHERE id = ? AND tenant_id = ? AND item_id = ? LIMIT 1").bind(line.unitId, access.context.tenantId, item.id).first<{ id: string; code: string; conversionFactor: number; isActive: number }>() : null;
      if (line.unitId && (!unit || !unit.isActive)) throw new ApiError("وحدة الصنف غير موجودة أو غير نشطة", 409);
      const unitQuantity = quantityToUnits(line.quantity, item.quantity_scale);
      const requestedUnits = Math.round(line.quantity * (unit?.conversionFactor ?? 1));
      if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 1) throw new ApiError("كمية الوحدة تتجاوز الحد المسموح");
      const increase = type === "adjustment" && line.direction === "increase";
      let allocations: StockAllocation[];
      if (increase) {
        let batchId: string | null = null;
        if (item.tracks_batches) {
          if (line.batchId) {
            const batch = await d1.prepare("SELECT id, expires_on AS expiresOn FROM inventory_batches WHERE id = ? AND tenant_id = ? AND item_id = ? LIMIT 1").bind(line.batchId, access.context.tenantId, item.id).first<{ id: string; expiresOn: string | null }>();
            if (!batch) throw new ApiError("التشغيلة لا تخص هذا الصنف أو مساحة العمل", 404);
            batchId = batch.id;
            if (line.expiresOn && line.expiresOn !== batch.expiresOn) throw new ApiError("تاريخ صلاحية التشغيلة لا يطابق التسجيل السابق", 409);
            if (item.tracks_expiry && batch.expiresOn && batch.expiresOn < new Date().toISOString().slice(0, 10)) throw new ApiError("لا يمكن زيادة رصيد تشغيلة منتهية الصلاحية؛ سجّل إتلافًا أو تسوية مخصصة", 409);
          } else {
            const lotNumber = line.lotNumber?.trim();
            if (!lotNumber) throw new ApiError("رقم التشغيلة مطلوب لزيادة رصيد صنف يتتبع التشغيلات");
            if (item.tracks_expiry && !line.expiresOn) throw new ApiError("تاريخ الصلاحية مطلوب لهذا الصنف");
            if (line.expiresOn && line.expiresOn < new Date().toISOString().slice(0, 10)) throw new ApiError("لا يمكن إضافة رصيد لتشغيلة منتهية الصلاحية");
            const key = `${item.id}:${lotNumber}`;
            const cached = newBatches.get(key);
            if (cached) {
              if (cached.expiresOn !== (line.expiresOn ?? null)) throw new ApiError("تاريخ صلاحية التشغيلة غير متطابق", 409);
              batchId = cached.id;
            } else {
              const existing = await d1.prepare("SELECT id, expires_on AS expiresOn FROM inventory_batches WHERE tenant_id = ? AND item_id = ? AND lot_number = ? LIMIT 1").bind(access.context.tenantId, item.id, lotNumber).first<{ id: string; expiresOn: string | null }>();
              if (existing && existing.expiresOn !== (line.expiresOn ?? null)) throw new ApiError("تاريخ صلاحية التشغيلة لا يطابق التسجيل السابق", 409);
              batchId = existing?.id ?? crypto.randomUUID();
              newBatches.set(key, { id: batchId, itemId: item.id, lotNumber, expiresOn: line.expiresOn ?? null, insert: !existing });
            }
          }
        } else if (line.batchId || line.lotNumber || line.expiresOn) throw new ApiError("هذا الصنف لا يستخدم التشغيلات أو الصلاحية");
        allocations = [{ batchId, quantity: requestedUnits, unitCostMinor: item.default_cost_minor }];
      } else {
        if (line.lotNumber || line.expiresOn) throw new ApiError("رقم التشغيلة وتاريخ الصلاحية يستخدمان فقط عند إدخال دفعة جديدة");
        allocations = await allocateStock(d1, { tenantId: access.context.tenantId, item, warehouseId: input.sourceWarehouseId, quantity: requestedUnits, batchId: line.batchId ?? undefined });
      }
      const batchLotNumber = increase && item.tracks_batches && !line.batchId ? line.lotNumber!.trim() : null;
      for (const allocation of allocations) {
        const signed = type === "adjustment" ? (increase ? allocation.quantity : -allocation.quantity) : -allocation.quantity;
        planned.push({ item, unitId: unit?.id ?? null, unitQuantity, unitCode: unit?.code ?? item.unit_code, unitConversionFactor: unit?.conversionFactor ?? 1, batchId: allocation.batchId, batchLotNumber, warehouseId: input.sourceWarehouseId, movementType: type === "transfer" ? "transfer_out" : type === "adjustment" ? "adjustment" : "stock_out", quantityDelta: type === "transfer" ? -allocation.quantity : signed, unitCostMinor: allocation.unitCostMinor, note: input.notes ?? type });
        if (type === "transfer") planned.push({ item, unitId: unit?.id ?? null, unitQuantity, unitCode: unit?.code ?? item.unit_code, unitConversionFactor: unit?.conversionFactor ?? 1, batchId: allocation.batchId, batchLotNumber: null, warehouseId: input.targetWarehouseId!, movementType: "transfer_in", quantityDelta: allocation.quantity, unitCostMinor: allocation.unitCostMinor, note: input.notes ?? "تحويل مخزون داخلي" });
      }
    }
    const statements: D1PreparedStatement[] = [d1.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, reference_type, reference_id, created_by, notes, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)")
      .bind(operationId, access.context.tenantId, operationType, requestKey, type, access.context.user.id, input.notes ?? null, JSON.stringify({ lineCount: input.lines.length, payloadHash: requestHash }), now)];
    for (const batch of newBatches.values()) if (batch.insert) statements.push(d1.prepare("INSERT INTO inventory_batches (id, tenant_id, item_id, lot_number, expires_on, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, item_id, lot_number) DO NOTHING").bind(batch.id, access.context.tenantId, batch.itemId, batch.lotNumber, batch.expiresOn, now, now));
    for (const movement of planned) {
      if (movement.batchLotNumber) {
        statements.push(createBalanceStatementByLot(d1, { id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: movement.item.id, warehouseId: movement.warehouseId, lotNumber: movement.batchLotNumber }));
        statements.push(d1.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) SELECT ?, ?, ?, ?, ?, b.id, ?, ?, ?, ?, ?, ?, ?, ? FROM inventory_batches b WHERE b.tenant_id = ? AND b.item_id = ? AND b.lot_number = ?").bind(crypto.randomUUID(), access.context.tenantId, operationId, movement.item.id, movement.warehouseId, movement.unitId, movement.unitQuantity, movement.unitCode, movement.unitConversionFactor, movement.movementType, movement.quantityDelta, movement.unitCostMinor, type, operationId, movement.note, access.context.user.id, now, access.context.tenantId, movement.item.id, movement.batchLotNumber));
      } else {
        statements.push(createBalanceStatement(d1, { id: crypto.randomUUID(), tenantId: access.context.tenantId, itemId: movement.item.id, warehouseId: movement.warehouseId, batchId: movement.batchId }));
        statements.push(d1.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), access.context.tenantId, operationId, movement.item.id, movement.warehouseId, movement.batchId, movement.unitId, movement.unitQuantity, movement.unitCode, movement.unitConversionFactor, movement.movementType, movement.quantityDelta, movement.unitCostMinor, type, operationId, movement.note, access.context.user.id, now));
      }
    }
    await d1.batch(statements);
    const movements = await getOperationMovements(d1, access.context.tenantId, operationId);
    await writeAudit(access.context, request, `inventory.${type}`, "stock_operation", operationId, { movements: planned.length, idempotencyKey: requestKey });
    return Response.json({ movements }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (requestKey) {
      const existing = await getExistingOperation(d1, access.context.tenantId, requestKey);
      if (existing) {
        if (existing.operation_type !== requestOperationType) return Response.json({ error: "مفتاح العملية استُخدم لنوع آخر", status: 409 }, { status: 409 });
        let existingHash: string | null = null;
        try { existingHash = JSON.parse(existing.metadata_json)?.payloadHash ?? null; } catch { /* unverifiable legacy payloads must conflict */ }
        if (!requestHash || existingHash !== requestHash) return Response.json({ error: "مفتاح العملية مستخدم لطلب مختلف؛ أنشئ مفتاحاً جديداً", status: 409 }, { status: 409 });
        return Response.json({ movements: await getOperationMovements(d1, access.context.tenantId, existing.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if (String(error).includes("INVENTORY_INSUFFICIENT_STOCK") || String(error).includes("INVENTORY_NEGATIVE_STOCK")) return Response.json({ error: "الرصيد غير كافٍ؛ لم يتم تسجيل أي جزء من الحركة" }, { status: 409 });
    return errorResponse(error);
  }
}
