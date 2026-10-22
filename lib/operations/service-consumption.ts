import { allocateStock, createBalanceStatement, getExistingOperation, quantityToUnits, type InventoryItemRow, type StockAllocation } from "@/lib/operations/inventory";
import { ApiError } from "@/lib/server/operations";

/**
 * Prepare the stock side of an appointment completion. The caller must place
 * its conditional appointment update in the same D1 batch before these
 * statements. Queue completion may additionally gate the operation on a ticket.
 */
export async function buildServiceConsumptionStatements(
  db: D1Database,
  input: { tenantId: string; appointmentId: string; serviceId: string; branchId: string; userId: string; now: number; queueTicketId?: string },
): Promise<D1PreparedStatement[]> {
  const materials = await db.prepare("SELECT sm.id, sm.item_id AS itemId, sm.warehouse_id AS warehouseId, sm.quantity_per_service AS quantityPerService, i.id AS item_id, i.tenant_id, i.sku, i.name, i.unit_code, i.quantity_scale, i.tracks_batches, i.tracks_expiry, i.default_cost_minor FROM service_materials sm JOIN inventory_items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id WHERE sm.tenant_id = ? AND sm.service_id = ? AND sm.is_active = 1 ORDER BY sm.id LIMIT 41")
    .bind(input.tenantId, input.serviceId)
    .all<{ id: string; itemId: string; warehouseId: string | null; quantityPerService: number; item_id: string; tenant_id: string; sku: string; name: string; unit_code: string; quantity_scale: number; tracks_batches: number; tracks_expiry: number; default_cost_minor: number }>();
  if (materials.results.length > 40) throw new ApiError("عدد مواد الخدمة يتجاوز الحد التشغيلي؛ قسّم الوصفة المادية", 409);
  if (!materials.results.length) return [];
  const operationKey = `service-consumption:${input.appointmentId}`;
  const priorOperation = await getExistingOperation(db, input.tenantId, operationKey);
  if (priorOperation) {
    if (priorOperation.operation_type !== "service_consumption") throw new ApiError("مرجع استهلاك مواد الموعد مرتبط بعملية أخرى", 409);
    return [];
  }
  const planned: Array<{ item: InventoryItemRow; warehouseId: string; allocation: StockAllocation }> = [];
  for (const row of materials.results) {
    if (!row.warehouseId) throw new ApiError("لم يُحدد مخزن لاستهلاك أحد مواد هذه الخدمة");
    const warehouse = await db.prepare("SELECT id, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1").bind(row.warehouseId, input.tenantId).first<{ id: string; branchId: string | null; isActive: number }>();
    if (!warehouse?.isActive) throw new ApiError("مخزن أحد مواد الخدمة غير موجود أو غير نشط", 409);
    if (warehouse.branchId && warehouse.branchId !== input.branchId) throw new ApiError("مخزن مادة الخدمة لا يتبع فرع الموعد؛ حدّث ربط المواد أو الفرع", 409);
    const item: InventoryItemRow = { id: row.item_id, tenant_id: row.tenant_id, sku: row.sku, name: row.name, unit_code: row.unit_code, quantity_scale: row.quantity_scale, tracks_batches: row.tracks_batches, tracks_expiry: row.tracks_expiry, default_cost_minor: row.default_cost_minor };
    const quantity = quantityToUnits(row.quantityPerService / (10 ** row.quantity_scale), row.quantity_scale);
    const allocations = await allocateStock(db, { tenantId: input.tenantId, item, warehouseId: warehouse.id, quantity });
    for (const allocation of allocations) planned.push({ item, warehouseId: warehouse.id, allocation });
  }
  const operationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [db.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, reference_type, reference_id, created_by, notes, metadata_json, created_at) SELECT ?, ?, 'service_consumption', ?, 'appointment', ?, ?, 'مواد مستخدمة عند إكمال الموعد', ?, ? WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.tenant_id = ? AND a.status = 'completed') AND NOT EXISTS (SELECT 1 FROM stock_operations o WHERE o.tenant_id = ? AND o.idempotency_key = ?) AND (? IS NULL OR EXISTS (SELECT 1 FROM queue_tickets q WHERE q.id = ? AND q.tenant_id = ? AND q.status = 'completed'))")
    .bind(operationId, input.tenantId, operationKey, input.appointmentId, input.userId, JSON.stringify({ serviceId: input.serviceId, materialCount: planned.length }), input.now, input.appointmentId, input.tenantId, input.tenantId, operationKey, input.queueTicketId ?? null, input.queueTicketId ?? "", input.tenantId)];
  for (const movement of planned) {
    statements.push(createBalanceStatement(db, { id: crypto.randomUUID(), tenantId: input.tenantId, itemId: movement.item.id, warehouseId: movement.warehouseId, batchId: movement.allocation.batchId }));
    statements.push(db.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) SELECT ?, ?, ?, ?, ?, ?, 'service_consumption', ?, ?, 'appointment', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM stock_operations o WHERE o.id = ? AND o.tenant_id = ? AND o.idempotency_key = ?)")
      .bind(crypto.randomUUID(), input.tenantId, operationId, movement.item.id, movement.warehouseId, movement.allocation.batchId, -movement.allocation.quantity, movement.allocation.unitCostMinor, input.appointmentId, `استهلاك خدمة عند إكمال موعد ${input.appointmentId}`, input.userId, input.now, operationId, input.tenantId, operationKey));
  }
  return statements;
}
