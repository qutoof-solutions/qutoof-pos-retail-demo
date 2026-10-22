import { ApiError } from "@/lib/operations/api-error";

export type OfflineConflictAction = "retry" | "edit" | "cancel" | "reallocate";

type ConflictRow = {
  id: string; tenantId: string; branchId: string; invoiceId: string; itemId: string; warehouseId: string;
  requestedQuantity: number; availableQuantity: number; shortageQuantity: number; quantityScale: number;
  resolution: string; acknowledgedAt: number | null;
};
type InvoiceRow = { id: string; branchId: string | null; status: string; subtotalMinor: number; discountMinor: number; totalMinor: number; paidMinor: number };
type InvoiceLine = { id: string; quantity: number; quantityScale: number; unitPriceMinor: number; unitConversionFactor: number | null; lineTotalMinor: number; inventoryItemId: string; stockWarehouseId: string | null };
type ItemRow = InventoryItemRow & { is_active: number };
type WarehouseRow = { id: string; branchId: string | null; isActive: number };
type ExistingAction = { conflictId: string; payloadHash: string; resultJson: string | null };
type Deduction = { id: string; itemId: string; warehouseId: string; batchId: string | null; quantity: number; unitCostMinor: number | null };
type D1Meta = { changes?: number };
type InventoryItemRow = { id: string; tenant_id: string; sku: string; name: string; unit_code: string; quantity_scale: number; tracks_batches: number; tracks_expiry: number; default_cost_minor: number };
type StockAllocation = { batchId: string | null; quantity: number; unitCostMinor: number };
type RefundPayment = { id: string; amountMinor: number; paymentMethod: string; createdAt: number };

async function allocateStock(db: D1Database, options: { tenantId: string; item: ItemRow; warehouseId: string; quantity: number; today?: string }): Promise<StockAllocation[]> {
  const { tenantId, item, warehouseId, quantity } = options;
  if (!item.tracks_batches) {
    const balance = await db.prepare("SELECT quantity_on_hand FROM inventory_balances WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_key = '' LIMIT 1")
      .bind(tenantId, item.id, warehouseId).first<{ quantity_on_hand: number }>();
    if ((balance?.quantity_on_hand ?? 0) < quantity) throw new ApiError("رصيد الصنف غير كافٍ", 409);
    return [{ batchId: null, quantity, unitCostMinor: item.default_cost_minor }];
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const expiryFilter = item.tracks_expiry ? " AND b.expires_on >= ?" : "";
  const statement = db.prepare(`SELECT b.id AS batch_id, COALESCE(q.quantity_on_hand, 0) AS quantity_on_hand FROM inventory_batches b LEFT JOIN inventory_balances q ON q.tenant_id = b.tenant_id AND q.item_id = b.item_id AND q.batch_id = b.id AND q.warehouse_id = ? WHERE b.tenant_id = ? AND b.item_id = ? AND COALESCE(q.quantity_on_hand, 0) > 0${expiryFilter} ORDER BY CASE WHEN ? = 1 THEN b.expires_on ELSE NULL END ASC, b.received_at ASC, b.id ASC`);
  const params: unknown[] = [warehouseId, tenantId, item.id];
  if (item.tracks_expiry) params.push(today);
  params.push(item.tracks_expiry);
  const rows = (await statement.bind(...params).all<{ batch_id: string; quantity_on_hand: number }>()).results;
  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const allocated = Math.min(remaining, row.quantity_on_hand);
    allocations.push({ batchId: row.batch_id, quantity: allocated, unitCostMinor: item.default_cost_minor });
    remaining -= allocated;
  }
  if (remaining > 0) throw new ApiError("رصيد دفعات الصنف الصالحة غير كافٍ", 409);
  return allocations;
}

export type OfflineConflictResolutionInput = {
  tenantId: string;
  actorId: string;
  conflictId: string;
  action: OfflineConflictAction;
  idempotencyKey: string;
  payloadHash: string;
  payloadJson: string;
  replacementQuantity?: number;
  replacementWarehouseId?: string;
  refundReference?: string;
  refundCompleted?: boolean;
  note?: string | null;
  now?: Date;
};

export type OfflineConflictResolutionResult = {
  actionId: string;
  conflictId: string;
  action: OfflineConflictAction;
  replayed: boolean;
  result: Record<string, unknown>;
};

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function existingResult(row: ExistingAction, input: OfflineConflictResolutionInput): OfflineConflictResolutionResult {
  if (row.payloadHash !== input.payloadHash || row.conflictId !== input.conflictId) {
    throw new ApiError("مفتاح معالجة التعارض مستخدم لطلب مختلف؛ أنشئ مفتاحاً جديداً", 409);
  }
  let result: Record<string, unknown> = {};
  try {
    const parsed = row.resultJson ? JSON.parse(row.resultJson) : {};
    if (parsed && typeof parsed === "object") result = parsed as Record<string, unknown>;
  } catch { /* preserve replay safety even if an old result was not JSON */ }
  return { actionId: "", conflictId: input.conflictId, action: input.action, replayed: true, result };
}

function validateQuantity(value: number | undefined, scale: number, message: string): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) throw new ApiError(message);
  if (scale < 0 || scale > 4 || !Number.isInteger(scale)) throw new ApiError("دقة كمية الصنف غير صالحة", 409);
  return value;
}

function balanceEnsure(db: D1Database, tenantId: string, itemId: string, warehouseId: string, batchId: string | null, id: string): D1PreparedStatement {
  return db.prepare("INSERT INTO inventory_balances (id, tenant_id, item_id, warehouse_id, batch_id, batch_key, quantity_on_hand, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (tenant_id, item_id, warehouse_id, batch_key) DO NOTHING")
    .bind(id, tenantId, itemId, warehouseId, batchId, batchId ?? "", Math.floor(Date.now() / 1000));
}

function duplicateOperationGuard(db: D1Database, operationId: string, tenantId: string): D1PreparedStatement {
  // The operation was inserted at the beginning of the batch. If the immediately
  // preceding conditional movement did not happen, this duplicate primary key
  // aborts the whole D1 batch instead of committing a partial stock resolution.
  return db.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, created_at) SELECT ?, ?, 'adjustment', ?, ? WHERE changes() = 0")
    .bind(operationId, tenantId, `offline-guard:${operationId}`, Math.floor(Date.now() / 1000));
}

function duplicateConflictGuard(db: D1Database, conflict: ConflictRow): D1PreparedStatement {
  // A failed optimistic conflict update must roll back the action and every
  // movement. The conflict primary key is already present, so this is a portable
  // D1 constraint guard (SQLite has no RAISE() expression outside a trigger).
  return db.prepare("INSERT INTO offline_stock_conflicts (id, tenant_id, branch_id, invoice_id, item_id, warehouse_id, requested_quantity, available_quantity, shortage_quantity, quantity_scale, resolution, created_at) SELECT id, tenant_id, branch_id, invoice_id, item_id, warehouse_id, requested_quantity, available_quantity, shortage_quantity, quantity_scale, resolution, created_at FROM offline_stock_conflicts WHERE id = ? AND changes() = 0")
    .bind(conflict.id);
}

function addDeductionStatements(statements: D1PreparedStatement[], db: D1Database, input: OfflineConflictResolutionInput, operationId: string, deduction: { itemId: string; warehouseId: string; batchId: string | null; quantity: number; unitCostMinor: number; movementType: "pos_deduction" | "adjustment" }, movementId: string, item: ItemRow, invoiceId: string, now: number): void {
  statements.push(balanceEnsure(db, input.tenantId, deduction.itemId, deduction.warehouseId, deduction.batchId, crypto.randomUUID()));
  if (deduction.movementType === "pos_deduction") {
    statements.push(db.prepare("UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand - ?, updated_at = ? WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_key = ? AND quantity_on_hand >= ?")
      .bind(deduction.quantity, now, input.tenantId, deduction.itemId, deduction.warehouseId, deduction.batchId ?? "", deduction.quantity));
    statements.push(db.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) SELECT ?, ?, ?, ?, ?, ?, 'pos_deduction', ?, ?, 'invoice', ?, ?, ?, ? WHERE changes() = 1")
      .bind(movementId, input.tenantId, operationId, deduction.itemId, deduction.warehouseId, deduction.batchId, -deduction.quantity, deduction.unitCostMinor, invoiceId, `معالجة تعارض أوفلاين: ${item.sku}`, input.actorId, now));
    statements.push(duplicateOperationGuard(db, operationId, input.tenantId));
  } else {
    statements.push(db.prepare("UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand + ?, updated_at = ? WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_key = ?")
      .bind(deduction.quantity, now, input.tenantId, deduction.itemId, deduction.warehouseId, deduction.batchId ?? ""));
    statements.push(db.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'adjustment', ?, ?, 'invoice', ?, ?, ?, ?)")
      .bind(movementId, input.tenantId, operationId, deduction.itemId, deduction.warehouseId, deduction.batchId, deduction.quantity, deduction.unitCostMinor, invoiceId, `إرجاع مخزون لإلغاء فاتورة أوفلاين: ${item.sku}`, input.actorId, now));
  }
}

export async function resolveOfflineConflict(db: D1Database, input: OfflineConflictResolutionInput): Promise<OfflineConflictResolutionResult> {
  const prior = await db.prepare("SELECT conflict_id AS conflictId, payload_hash AS payloadHash, result_json AS resultJson FROM offline_conflict_actions WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1")
    .bind(input.tenantId, input.idempotencyKey).first<ExistingAction>();
  if (prior) return existingResult(prior, input);

  const conflict = await db.prepare("SELECT id, tenant_id AS tenantId, branch_id AS branchId, invoice_id AS invoiceId, item_id AS itemId, warehouse_id AS warehouseId, requested_quantity AS requestedQuantity, available_quantity AS availableQuantity, shortage_quantity AS shortageQuantity, quantity_scale AS quantityScale, resolution, acknowledged_at AS acknowledgedAt FROM offline_stock_conflicts WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(input.conflictId, input.tenantId).first<ConflictRow>();
  if (!conflict) throw new ApiError("تنبيه العجز غير موجود", 404);
  if (conflict.resolution !== "pending" || conflict.acknowledgedAt !== null) throw new ApiError("تم تسجيل قرار هذا التعارض مسبقاً", 409);

  const invoice = await db.prepare("SELECT id, branch_id AS branchId, status, subtotal_minor AS subtotalMinor, discount_minor AS discountMinor, total_minor AS totalMinor, paid_minor AS paidMinor FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(conflict.invoiceId, input.tenantId).first<InvoiceRow>();
  if (!invoice) throw new ApiError("الفاتورة المرتبطة بالتعارض غير موجودة", 404);
  const item = await db.prepare("SELECT id, tenant_id, sku, name, unit_code, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor, is_active FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(conflict.itemId, input.tenantId).first<ItemRow>();
  if (!item || !item.is_active) throw new ApiError("الصنف المرتبط بالتعارض غير موجود أو غير نشط", 409);
  if (item.quantity_scale !== conflict.quantityScale) throw new ApiError("تغيرت دقة قياس الصنف؛ لا يمكن معالجة التعارض بأمان", 409);

  const line = await db.prepare("SELECT id, quantity, quantity_scale AS quantityScale, unit_price_minor AS unitPriceMinor, unit_conversion_factor AS unitConversionFactor, line_total_minor AS lineTotalMinor, inventory_item_id AS inventoryItemId, stock_warehouse_id AS stockWarehouseId FROM invoice_items WHERE tenant_id = ? AND invoice_id = ? AND inventory_item_id = ? AND stock_warehouse_id = ? LIMIT 1")
    .bind(input.tenantId, conflict.invoiceId, conflict.itemId, conflict.warehouseId).first<InvoiceLine>();
  if (!line) throw new ApiError("بند الصنف المرتبط بالتعارض غير موجود في الفاتورة", 409);

  const fulfilledRow = await db.prepare("SELECT COALESCE(SUM(-quantity_delta), 0) AS fulfilled FROM stock_movements WHERE tenant_id = ? AND reference_type = 'invoice' AND reference_id = ? AND item_id = ? AND movement_type = 'pos_deduction' AND quantity_delta < 0")
    .bind(input.tenantId, conflict.invoiceId, conflict.itemId).first<{ fulfilled: number }>();
  const fulfilled = Math.max(0, Math.trunc(asNumber(fulfilledRow?.fulfilled)));
  const remainingShortage = Math.max(0, conflict.requestedQuantity - fulfilled);
  const replacementQuantity = input.replacementQuantity;
  if (input.action === "edit") {
    const target = validateQuantity(replacementQuantity, conflict.quantityScale, "الكمية النهائية المطلوبة للتعديل غير صالحة");
    if (target > conflict.requestedQuantity) throw new ApiError("الكمية المعدلة لا يمكن أن تتجاوز الكمية المطلوبة", 409);
    if (target < fulfilled) throw new ApiError("لا يمكن خفض الفاتورة إلى أقل من الكمية المصروفة فعلياً", 409);
  } else if (input.action === "retry" || input.action === "reallocate") {
    const targetShortage = replacementQuantity === undefined ? remainingShortage : validateQuantity(replacementQuantity, conflict.quantityScale, "كمية العجز المتبقي غير صالحة");
    if (targetShortage !== remainingShortage) throw new ApiError("تغير العجز المتبقي؛ حدّث التنبيه وأعد المحاولة", 409);
    if (targetShortage < 1) throw new ApiError("لا يوجد عجز متبقٍ لمعالجته", 409);
  }

  let targetWarehouseId = conflict.warehouseId;
  if (input.action === "reallocate") {
    if (!input.replacementWarehouseId || input.replacementWarehouseId === conflict.warehouseId) throw new ApiError("المخزن البديل مطلوب ويجب أن يختلف عن المخزن الأصلي");
    targetWarehouseId = input.replacementWarehouseId;
  }
  const targetWarehouse = await db.prepare("SELECT id, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(targetWarehouseId, input.tenantId).first<WarehouseRow>();
  if ((input.action === "retry" || input.action === "reallocate" || input.action === "edit") && (!targetWarehouse || !targetWarehouse.isActive)) throw new ApiError("المخزن المطلوب غير موجود أو غير نشط", 409);

  const deductions: Array<{ itemId: string; warehouseId: string; batchId: string | null; quantity: number; unitCostMinor: number; movementType: "pos_deduction" | "adjustment" }> = [];
  let operationId: string | null = null;
  let targetQuantity: number | null = null;
  let totalDeltaMinor = 0;
  let refundedPaymentMinor = 0;
  let refundPaymentCount = 0;
  let refundGuardPaymentId: string | null = null;
  let refundedPayments: RefundPayment[] = [];
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (input.action === "retry" || input.action === "reallocate" || input.action === "edit") {
    targetQuantity = input.action === "edit" ? replacementQuantity! : conflict.requestedQuantity;
    const stockNeeded = Math.max(0, targetQuantity - fulfilled);
    if (stockNeeded > 0) {
      const allocation = await allocateStock(db, { tenantId: input.tenantId, item, warehouseId: targetWarehouseId, quantity: stockNeeded });
      for (const row of allocation) deductions.push({ itemId: item.id, warehouseId: targetWarehouseId, batchId: row.batchId, quantity: row.quantity, unitCostMinor: row.unitCostMinor, movementType: "pos_deduction" });
    }
    if (input.action === "edit") {
      const factor = line.unitConversionFactor && line.unitConversionFactor > 0 ? line.unitConversionFactor : 1;
      const nextLineTotal = Math.round(targetQuantity! * line.unitPriceMinor / factor / (10 ** line.quantityScale));
      totalDeltaMinor = nextLineTotal - line.lineTotalMinor;
      if (invoice.totalMinor + totalDeltaMinor < invoice.paidMinor) throw new ApiError("لا يمكن تعديل الفاتورة إلى إجمالي أقل من المدفوع؛ سجّل ردًا أو رصيدًا محاسبيًا أولاً", 409);
    }
  } else {
    if (invoice.paidMinor > 0) {
      if (input.refundCompleted !== true || !input.refundReference?.trim()) throw new ApiError("offline_conflict_refund_required", 409);
      const paidRows = await db.prepare("SELECT id, amount_minor AS amountMinor, payment_method AS paymentMethod, created_at AS createdAt FROM invoice_payments WHERE tenant_id = ? AND invoice_id = ? AND reversed_at IS NULL")
        .bind(input.tenantId, invoice.id).all<RefundPayment>();
      refundedPayments = paidRows.results;
      refundedPaymentMinor = paidRows.results.reduce((total, row) => total + asNumber(row.amountMinor), 0);
      refundPaymentCount = paidRows.results.length;
      if (refundPaymentCount === 0 || refundedPaymentMinor !== invoice.paidMinor) throw new ApiError("offline_conflict_refund_reconciliation_failed", 409);
      refundGuardPaymentId = paidRows.results[0]!.id;
    }
    const rows = await db.prepare("SELECT id, item_id AS itemId, warehouse_id AS warehouseId, batch_id AS batchId, -quantity_delta AS quantity, unit_cost_minor AS unitCostMinor FROM stock_movements WHERE tenant_id = ? AND reference_type = 'invoice' AND reference_id = ? AND movement_type = 'pos_deduction' AND quantity_delta < 0")
      .bind(input.tenantId, invoice.id).all<Deduction>();
    for (const row of rows.results) deductions.push({ itemId: row.itemId, warehouseId: row.warehouseId, batchId: row.batchId, quantity: Math.trunc(row.quantity), unitCostMinor: row.unitCostMinor ?? item.default_cost_minor, movementType: "adjustment" });
    targetQuantity = 0;
    totalDeltaMinor = -invoice.totalMinor;
  }

  if (deductions.length) operationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (operationId) statements.push(db.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, reference_type, reference_id, created_by, notes, metadata_json, created_at) VALUES (?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?)")
    .bind(operationId, input.tenantId, input.action === "cancel" ? "adjustment" : "point_of_sale", `offline-conflict/${input.idempotencyKey}`, invoice.id, input.actorId, `معالجة تعارض مخزون أوفلاين: ${input.action}`, JSON.stringify({ conflictId: input.conflictId, action: input.action, payloadHash: input.payloadHash }), now));
  const movementIds = deductions.map(() => crypto.randomUUID());
  deductions.forEach((deduction, index) => addDeductionStatements(statements, db, input, operationId!, deduction, movementIds[index]!, item, invoice.id, now));

  if (input.action === "edit") {
    const target = targetQuantity!;
    const factor = line.unitConversionFactor && line.unitConversionFactor > 0 ? line.unitConversionFactor : 1;
    const nextLineTotal = Math.round(target * line.unitPriceMinor / factor / (10 ** line.quantityScale));
    statements.push(db.prepare("UPDATE invoice_items SET quantity = ?, line_total_minor = ? WHERE id = ? AND tenant_id = ? AND invoice_id = ? AND quantity = ? AND line_total_minor = ?")
      .bind(target, nextLineTotal, line.id, input.tenantId, invoice.id, line.quantity, line.lineTotalMinor));
    statements.push(db.prepare("UPDATE invoices SET subtotal_minor = subtotal_minor + ?, total_minor = total_minor + ?, status = CASE WHEN paid_minor = 0 THEN 'issued' WHEN paid_minor >= total_minor + ? THEN 'paid' ELSE 'partially_paid' END, paid_at = CASE WHEN paid_minor >= total_minor + ? THEN paid_at ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND subtotal_minor = ? AND total_minor = ? AND paid_minor = ? AND changes() = 1")
      .bind(totalDeltaMinor, totalDeltaMinor, totalDeltaMinor, totalDeltaMinor, now, invoice.id, input.tenantId, invoice.subtotalMinor, invoice.totalMinor, invoice.paidMinor));
    statements.push(db.prepare("INSERT INTO invoice_adjustments (id, tenant_id, invoice_id, branch_id, adjustment_type, idempotency_key, payload_hash, subtotal_delta_minor, discount_delta_minor, total_delta_minor, reason, metadata_json, adjusted_by, created_at) SELECT ?, ?, ?, ?, 'edit', ?, ?, ?, 0, ?, ?, ?, ?, ? WHERE changes() = 1")
      .bind(crypto.randomUUID(), input.tenantId, invoice.id, invoice.branchId, input.idempotencyKey, input.payloadHash, totalDeltaMinor, totalDeltaMinor, input.note ?? "تعديل كمية تعارض أوفلاين", JSON.stringify({ conflictId: input.conflictId, fromQuantity: line.quantity, toQuantity: target }), input.actorId, now));
  } else if (input.action === "cancel") {
    statements.push(db.prepare("UPDATE installment_contracts SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND invoice_id = ? AND status = 'active'").bind(now, input.tenantId, invoice.id));
    statements.push(db.prepare("UPDATE installment_schedules SET status = 'unpaid', paid_minor = 0, paid_at = NULL, paid_by = NULL, payment_method = NULL, reference = NULL, updated_at = ? WHERE tenant_id = ? AND invoice_id = ?").bind(now, input.tenantId, invoice.id));
    if (refundPaymentCount > 0) {
      statements.push(db.prepare("UPDATE invoice_payments SET reversed_at = ?, reversed_by = ?, reversal_reason = ? WHERE tenant_id = ? AND invoice_id = ? AND reversed_at IS NULL")
        .bind(now, input.actorId, `offline_conflict_refund:${input.refundReference!.trim()}`, input.tenantId, invoice.id));
      statements.push(db.prepare("INSERT INTO invoice_payments (id, tenant_id, invoice_id, amount_minor, payment_method, created_at) SELECT id, tenant_id, invoice_id, amount_minor, payment_method, created_at FROM invoice_payments WHERE id = ? AND changes() != ?")
        .bind(refundGuardPaymentId, refundPaymentCount));
    }
    statements.push(db.prepare("UPDATE invoices SET subtotal_minor = 0, discount_minor = 0, installment_fee_minor = 0, total_minor = 0, status = 'void', paid_minor = 0, payment_method = 'unpaid', paid_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND paid_minor = ? AND status <> 'void'" + (refundPaymentCount > 0 ? " AND changes() = 0" : ""))
      .bind(now, invoice.id, input.tenantId, invoice.paidMinor));
    statements.push(db.prepare("INSERT INTO invoice_adjustments (id, tenant_id, invoice_id, branch_id, adjustment_type, idempotency_key, payload_hash, subtotal_delta_minor, discount_delta_minor, total_delta_minor, reason, metadata_json, adjusted_by, created_at) SELECT ?, ?, ?, ?, 'cancel', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
      .bind(crypto.randomUUID(), input.tenantId, invoice.id, invoice.branchId, input.idempotencyKey, input.payloadHash, -invoice.subtotalMinor, -invoice.discountMinor, -invoice.totalMinor, input.note ?? "Offline conflict cancellation", JSON.stringify({ conflictId: input.conflictId, refundRecorded: refundPaymentCount > 0, refundedPaymentMinor, refundReference: refundPaymentCount > 0 ? input.refundReference!.trim() : null, reversedPaymentCount: refundPaymentCount }), input.actorId, now));
    for (const payment of refundedPayments) {
      statements.push(db.prepare("INSERT INTO shift_settlement_adjustments (id, tenant_id, settlement_id, payment_method, amount_delta_minor, reason, created_by, created_at) SELECT ?, ?, s.id, p.payment_method, -p.amount_minor, ?, ?, ? FROM shift_settlements s JOIN invoice_payments p ON p.tenant_id = s.tenant_id AND p.invoice_id = ? WHERE s.tenant_id = ? AND s.branch_id = ? AND s.status = 'closed' AND p.id = ? AND p.reversed_at = ? AND p.created_at >= s.opened_at AND p.created_at <= CASE WHEN s.closed_at < 1000000000000 THEN s.closed_at * 1000 ELSE s.closed_at END ORDER BY s.closed_at DESC LIMIT 1")
        .bind(crypto.randomUUID(), input.tenantId, `offline_conflict_refund:${input.refundReference?.trim() ?? ""}`, input.actorId, now, invoice.id, input.tenantId, invoice.branchId, payment.id, now));
    }
  }

  const resolutionQuantity = input.action === "cancel" ? null : targetQuantity;
  const resolutionSql = "UPDATE offline_stock_conflicts SET resolution = ?, replacement_quantity = ?, replacement_warehouse_id = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?, acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND tenant_id = ? AND resolution = 'pending' AND acknowledged_at IS NULL" + (input.action === "edit" || input.action === "cancel" ? " AND EXISTS (SELECT 1 FROM invoice_adjustments WHERE tenant_id = ? AND idempotency_key = ?)" : "");
  const resolutionStatement = db.prepare(resolutionSql);
  statements.push(input.action === "edit" || input.action === "cancel"
    ? resolutionStatement.bind(input.action, resolutionQuantity, null, input.note?.trim() || null, now, input.actorId, now, input.actorId, conflict.id, input.tenantId, input.tenantId, input.idempotencyKey)
    : resolutionStatement.bind(input.action, resolutionQuantity, input.action === "reallocate" ? targetWarehouseId : null, input.note?.trim() || null, now, input.actorId, now, input.actorId, conflict.id, input.tenantId));
  const result = { operationId, movementIds, fulfilledBefore: fulfilled, fulfilledAfter: input.action === "cancel" ? 0 : fulfilled + deductions.reduce((sum, row) => sum + row.quantity, 0), targetQuantity, totalDeltaMinor, refundRecorded: refundPaymentCount > 0, refundedPaymentMinor, refundedPaymentCount: refundPaymentCount, refundReference: refundPaymentCount > 0 ? input.refundReference!.trim() : null };
  const actionId = crypto.randomUUID();
  statements.push(db.prepare("INSERT INTO offline_conflict_actions (id, tenant_id, conflict_id, idempotency_key, payload_hash, action, payload_json, result_json, actor_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
    .bind(actionId, input.tenantId, conflict.id, input.idempotencyKey, input.payloadHash, input.action, input.payloadJson, JSON.stringify(result), input.actorId, now));
  statements.push(duplicateConflictGuard(db, conflict));

  try {
    const results = await db.batch(statements);
    const actionChanges = (results.at(-2)?.meta as D1Meta | undefined)?.changes;
    if (actionChanges !== 1) throw new ApiError("تعذر تسجيل قرار التعارض؛ لم يتم تغيير البيانات", 409);
    return { actionId, conflictId: conflict.id, action: input.action, replayed: false, result };
  } catch (error) {
    const replay = await db.prepare("SELECT conflict_id AS conflictId, payload_hash AS payloadHash, result_json AS resultJson FROM offline_conflict_actions WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1")
      .bind(input.tenantId, input.idempotencyKey).first<ExistingAction>();
    if (replay) return existingResult(replay, input);
    throw error;
  }
}
