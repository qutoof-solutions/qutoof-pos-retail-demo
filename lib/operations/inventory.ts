import { ApiError } from "@/lib/server/operations";
import { splitOfflineStock } from "@/lib/operations/offline-stock";

export type InventoryItemRow = { id: string; tenant_id: string; sku: string; name: string; unit_code: string; quantity_scale: number; tracks_batches: number; tracks_expiry: number; default_cost_minor: number };
export type StockAllocation = { batchId: string | null; quantity: number; unitCostMinor: number };

export function quantityToUnits(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(scale) || scale < 0 || scale > 4) throw new ApiError("كمية المخزون غير صالحة");
  const factor = 10 ** scale;
  const units = Math.round(value * factor);
  if (!Number.isSafeInteger(units) || units < 1 || Math.abs(units / factor - value) > 1e-8) throw new ApiError(`الكمية يجب أن تكون مضاعفاً صحيحاً لوحدة القياس (الدقة ${scale} منازل)`);
  return units;
}

export function unitsToQuantity(units: number, scale: number): number {
  return units / (10 ** scale);
}

export async function allocateStock(
  db: D1Database,
  options: { tenantId: string; item: InventoryItemRow; warehouseId: string; quantity: number; batchId?: string | null; today?: string },
): Promise<StockAllocation[]> {
  const { tenantId, item, warehouseId, quantity } = options;
  if (!item.tracks_batches) {
    const balance = await db.prepare("SELECT quantity_on_hand FROM inventory_balances WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_key = '' LIMIT 1")
      .bind(tenantId, item.id, warehouseId).first<{ quantity_on_hand: number }>();
    if ((balance?.quantity_on_hand ?? 0) < quantity) throw new ApiError(`رصيد «${item.name}» غير كافٍ`, 409);
    return [{ batchId: null, quantity, unitCostMinor: item.default_cost_minor }];
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const batchFilter = options.batchId ? " AND b.id = ?" : "";
  const expiryFilter = item.tracks_expiry ? " AND b.expires_on >= ?" : "";
  const statement = db.prepare(`SELECT b.id AS batch_id, b.expires_on, b.received_at, COALESCE(q.quantity_on_hand, 0) AS quantity_on_hand FROM inventory_batches b LEFT JOIN inventory_balances q ON q.tenant_id = b.tenant_id AND q.item_id = b.item_id AND q.batch_id = b.id AND q.warehouse_id = ? WHERE b.tenant_id = ? AND b.item_id = ? AND COALESCE(q.quantity_on_hand, 0) > 0${expiryFilter}${batchFilter} ORDER BY CASE WHEN ? = 1 THEN b.expires_on ELSE NULL END ASC, b.received_at ASC, b.id ASC`);
  const params: unknown[] = [warehouseId, tenantId, item.id];
  if (item.tracks_expiry) params.push(today);
  if (options.batchId) params.push(options.batchId);
  params.push(item.tracks_expiry);
  const rows = (await statement.bind(...params).all<{ batch_id: string; expires_on: string | null; received_at: number; quantity_on_hand: number }>()).results;
  if (options.batchId && !rows.length) throw new ApiError("دفعة المخزون غير متاحة في هذا المخزن أو منتهية الصلاحية", 409);
  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const allocated = Math.min(remaining, row.quantity_on_hand);
    allocations.push({ batchId: row.batch_id, quantity: allocated, unitCostMinor: item.default_cost_minor });
    remaining -= allocated;
  }
  if (remaining > 0) throw new ApiError(`رصيد «${item.name}» غير كافٍ في الدفعات الصالحة`, 409);
  return allocations;
}

export async function allocateStockForOfflineSale(
  db: D1Database,
  options: { tenantId: string; item: InventoryItemRow; warehouseId: string; quantity: number; today?: string },
): Promise<{ allocations: StockAllocation[]; available: number; shortage: number }> {
  const { tenantId, item, warehouseId, quantity } = options;
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new ApiError("كمية المخزون غير صالحة");
  if (!item.tracks_batches) {
    const balance = await db.prepare("SELECT quantity_on_hand FROM inventory_balances WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_key = '' LIMIT 1")
      .bind(tenantId, item.id, warehouseId).first<{ quantity_on_hand: number }>();
    const available = Math.max(0, balance?.quantity_on_hand ?? 0);
    const split = splitOfflineStock(quantity, available);
    return {
      allocations: split.allocated ? [{ batchId: null, quantity: split.allocated, unitCostMinor: item.default_cost_minor }] : [],
      available,
      shortage: split.shortage,
    };
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const expiryFilter = item.tracks_expiry ? " AND b.expires_on >= ?" : "";
  const statement = db.prepare(`SELECT b.id AS batch_id, b.expires_on, b.received_at, COALESCE(q.quantity_on_hand, 0) AS quantity_on_hand FROM inventory_batches b LEFT JOIN inventory_balances q ON q.tenant_id = b.tenant_id AND q.item_id = b.item_id AND q.batch_id = b.id AND q.warehouse_id = ? WHERE b.tenant_id = ? AND b.item_id = ? AND COALESCE(q.quantity_on_hand, 0) > 0${expiryFilter} ORDER BY CASE WHEN ? = 1 THEN b.expires_on ELSE NULL END ASC, b.received_at ASC, b.id ASC`);
  const params: unknown[] = [warehouseId, tenantId, item.id];
  if (item.tracks_expiry) params.push(today);
  params.push(item.tracks_expiry);
  const rows = (await statement.bind(...params).all<{ batch_id: string; expires_on: string | null; received_at: number; quantity_on_hand: number }>()).results;
  const available = rows.reduce((total, row) => total + Math.max(0, row.quantity_on_hand), 0);
  const split = splitOfflineStock(quantity, available);
  let remaining = split.allocated;
  const allocations: StockAllocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const allocated = Math.min(remaining, row.quantity_on_hand);
    if (allocated > 0) allocations.push({ batchId: row.batch_id, quantity: allocated, unitCostMinor: item.default_cost_minor });
    remaining -= allocated;
  }
  return { allocations, available, shortage: split.shortage };
}

export function createBalanceStatement(db: D1Database, data: { id: string; tenantId: string; itemId: string; warehouseId: string; batchId: string | null }): D1PreparedStatement {
  return db.prepare("INSERT INTO inventory_balances (id, tenant_id, item_id, warehouse_id, batch_id, batch_key, quantity_on_hand, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, unixepoch()) ON CONFLICT (tenant_id, item_id, warehouse_id, batch_key) DO NOTHING")
    .bind(data.id, data.tenantId, data.itemId, data.warehouseId, data.batchId, data.batchId ?? "");
}

export function createBalanceStatementByLot(db: D1Database, data: { id: string; tenantId: string; itemId: string; warehouseId: string; lotNumber: string }): D1PreparedStatement {
  return db.prepare("INSERT INTO inventory_balances (id, tenant_id, item_id, warehouse_id, batch_id, batch_key, quantity_on_hand, updated_at) SELECT ?, ?, ?, ?, b.id, b.id, 0, unixepoch() FROM inventory_batches b WHERE b.tenant_id = ? AND b.item_id = ? AND b.lot_number = ? ON CONFLICT (tenant_id, item_id, warehouse_id, batch_key) DO NOTHING")
    .bind(data.id, data.tenantId, data.itemId, data.warehouseId, data.tenantId, data.itemId, data.lotNumber);
}

export async function getExistingOperation(db: D1Database, tenantId: string, idempotencyKey: string): Promise<{ id: string; operation_type: string; metadata_json: string } | null> {
  return db.prepare("SELECT id, operation_type, metadata_json FROM stock_operations WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(tenantId, idempotencyKey).first<{ id: string; operation_type: string; metadata_json: string }>();
}

export async function getOperationMovements(db: D1Database, tenantId: string, operationId: string): Promise<unknown[]> {
  const result = await db.prepare("SELECT m.id, m.movement_type AS movementType, m.item_id AS itemId, i.name AS itemName, m.warehouse_id AS warehouseId, w.name AS warehouseName, m.batch_id AS batchId, b.lot_number AS lotNumber, m.quantity_delta AS quantityDelta, m.unit_cost_minor AS unitCostMinor, m.created_at AS createdAt FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id JOIN inventory_warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id LEFT JOIN inventory_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id WHERE m.tenant_id = ? AND m.operation_id = ? ORDER BY m.created_at, m.id")
    .bind(tenantId, operationId).all();
  return result.results;
}
