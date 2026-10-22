import { z } from "zod";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { createBalanceStatement, createBalanceStatementByLot } from "@/lib/operations/inventory";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleWarehouseIds, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const purchaseInput = z.object({ idempotencyKey: z.string().trim().min(8).max(120), supplierId: uuidSchema, warehouseId: uuidSchema, invoiceNumber: z.string().trim().min(1).max(80), paidAmount: moneySchema.max(100_000_000).default(0), paymentMethod: z.enum(["cash", "bank", "wallet", "instapay"]).default("cash"), paymentReference: z.string().trim().max(160).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(), lines: z.array(z.object({ itemId: uuidSchema, unitId: uuidSchema.optional(), quantity: z.number().finite().gt(0).max(1_000_000), unitCost: moneySchema.max(10_000_000), lotNumber: z.string().trim().max(80).nullable().optional(), expiresOn: z.string().date().nullable().optional() })).min(1).max(18) });

type ItemRow = { id: string; quantity_scale: number; tracks_batches: number; tracks_expiry: number; is_active: number };
type UnitRow = { id: string; code: string; conversion_factor: number; is_active: number };

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ purchases: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const result = await access.context.env.DB.prepare(`SELECT p.id, p.invoice_number AS invoiceNumber, p.total_minor AS totalMinor, p.paid_minor AS paidMinor, p.total_minor - p.paid_minor AS payableMinor, p.status, p.notes, p.created_at AS createdAt, s.id AS supplierId, s.name AS supplierName, w.id AS warehouseId, w.name AS warehouseName, COUNT(l.id) AS linesCount FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = p.tenant_id LEFT JOIN purchase_invoice_lines l ON l.purchase_invoice_id = p.id AND l.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.warehouse_id IN (${placeholders}) GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`).bind(access.context.tenantId, ...warehouseIds).all();
  return Response.json({ purchases: result.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  let requestKey = "";
  try {
    const parsed = purchaseInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات فاتورة المورد والبنود والكميات");
    const input = parsed.data;
    const initialWarehouse = await d1.prepare("SELECT id, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1").bind(input.warehouseId, access.context.tenantId).first<{ id: string; branchId: string | null; isActive: number }>();
    if (!initialWarehouse?.isActive) throw new ApiError("المخزن غير موجود أو غير نشط", 404);
    await requireWarehouseBranchMembership(access.context, initialWarehouse.branchId);
    requestKey = input.idempotencyKey;
    const tenantId = access.context.tenantId;
    const existing = await d1.prepare("SELECT id, operation_type AS operationType FROM stock_operations WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(tenantId, input.idempotencyKey).first<{ id: string; operationType: string }>();
    if (existing) {
      if (existing.operationType !== "purchase_receipt") throw new ApiError("مفتاح العملية استُخدم لنوع آخر", 409);
      const invoice = await d1.prepare("SELECT id, invoice_number AS invoiceNumber, total_minor AS totalMinor, paid_minor AS paidMinor, status FROM purchase_invoices WHERE tenant_id = ? AND operation_id = ? LIMIT 1").bind(tenantId, existing.id).first();
      return Response.json({ purchase: invoice, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const supplier = await d1.prepare("SELECT id FROM suppliers WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.supplierId, tenantId).first();
    const warehouse = await d1.prepare("SELECT id FROM inventory_warehouses WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1").bind(input.warehouseId, tenantId).first();
    if (!supplier) throw new ApiError("المورد غير موجود أو غير نشط", 404);
    if (!warehouse) throw new ApiError("المخزن غير موجود أو غير نشط", 404);
    const operationId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const batchIds = new Map<string, { id: string; insert: boolean }>();
    const lines: Array<{ id: string; itemId: string; unitId: string | null; unitQuantity: number; unitCode: string; unitConversionFactor: number; batchId: string | null; batchLotNumber: string | null; quantity: number; unitCostMinor: number; lineTotalMinor: number }> = [];
    let totalMinor = 0;
    for (const line of input.lines) {
      const item = await d1.prepare("SELECT id, quantity_scale, tracks_batches, tracks_expiry, is_active FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1").bind(line.itemId, tenantId).first<ItemRow>();
      if (!item || !item.is_active) throw new ApiError("أحد الأصناف غير موجود أو غير نشط", 404);
      const baseFactor = 10 ** item.quantity_scale;
      const unit = line.unitId ? await d1.prepare("SELECT id, code, conversion_factor, is_active FROM inventory_item_units WHERE id = ? AND tenant_id = ? AND item_id = ? LIMIT 1").bind(line.unitId, tenantId, item.id).first<UnitRow>() : null;
      if (line.unitId && (!unit || !unit.is_active)) throw new ApiError("وحدة الصنف غير موجودة أو غير نشطة", 409);
      const conversionFactor = unit?.conversion_factor ?? 1;
      const unitQuantity = Math.round(line.quantity * baseFactor);
      const quantity = Math.round(line.quantity * conversionFactor);
      if (!Number.isSafeInteger(unitQuantity) || unitQuantity < 1 || Math.abs(unitQuantity / baseFactor - line.quantity) > 1e-8 || !Number.isSafeInteger(quantity) || quantity < 1) throw new ApiError("إحدى الكميات لا تتوافق مع وحدة القياس المختارة");
      const unitCostMinor = Math.round(line.unitCost * 100);
      const lineTotalMinor = Math.round(line.quantity * unitCostMinor);
      if (!Number.isSafeInteger(unitCostMinor) || unitCostMinor < 1 || !Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 1) throw new ApiError("سعر التكلفة أو قيمة البند غير صالح");
      let batchId: string | null = null;
      let batchLotNumber: string | null = null;
      if (item.tracks_batches) {
        const lotNumber = line.lotNumber?.trim();
        if (!lotNumber) throw new ApiError("رقم التشغيلة مطلوب لهذا الصنف");
        batchLotNumber = lotNumber;
        if (item.tracks_expiry && !line.expiresOn) throw new ApiError("تاريخ الصلاحية مطلوب لهذا الصنف");
        if (line.expiresOn && line.expiresOn < new Date().toISOString().slice(0, 10)) throw new ApiError("لا يمكن استلام تشغيلة منتهية الصلاحية");
        const mapKey = `${line.itemId}:${lotNumber}`;
        const cached = batchIds.get(mapKey);
        if (cached) batchId = cached.id;
        else {
          const existingBatch = await d1.prepare("SELECT id, expires_on AS expiresOn FROM inventory_batches WHERE tenant_id = ? AND item_id = ? AND lot_number = ? LIMIT 1").bind(tenantId, line.itemId, lotNumber).first<{ id: string; expiresOn: string | null }>();
          if (existingBatch && existingBatch.expiresOn !== (line.expiresOn ?? null)) throw new ApiError("تاريخ صلاحية رقم التشغيلة لا يطابق التسجيل السابق", 409);
          batchId = existingBatch?.id ?? crypto.randomUUID();
          batchIds.set(mapKey, { id: batchId, insert: !existingBatch });
        }
      } else if (line.lotNumber || line.expiresOn) throw new ApiError("هذا الصنف لا يستخدم التشغيلة أو الصلاحية");
      totalMinor += lineTotalMinor;
      if (!Number.isSafeInteger(totalMinor)) throw new ApiError("إجمالي فاتورة الشراء يتجاوز الحد المسموح");
      lines.push({ id: crypto.randomUUID(), itemId: line.itemId, unitId: unit?.id ?? null, unitQuantity, unitCode: unit?.code ?? "base", unitConversionFactor: conversionFactor, batchId, batchLotNumber, quantity, unitCostMinor, lineTotalMinor });
    }
    const paidMinor = Math.round(input.paidAmount * 100);
    if (!Number.isSafeInteger(paidMinor) || paidMinor < 0 || paidMinor > totalMinor) throw new ApiError("الدفعة المقدمة تتجاوز رصيد فاتورة المورد");
    if (input.lines.some((line) => line.unitCost <= 0)) throw new ApiError("سعر التكلفة يجب أن يكون أكبر من صفر");
    const statements: D1PreparedStatement[] = [
      d1.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, reference_type, reference_id, created_by, notes, metadata_json, created_at) VALUES (?, ?, 'purchase_receipt', ?, 'purchase_invoice', ?, ?, ?, '{}', ?)").bind(operationId, tenantId, input.idempotencyKey, invoiceId, access.context.user.id, input.notes ?? null, now),
    ];
    for (const [key, batch] of batchIds) {
      if (batch.insert) {
        const [itemId, ...lotParts] = key.split(":");
        const lotNumber = lotParts.join(":");
        const line = input.lines.find((entry) => entry.itemId === itemId && entry.lotNumber?.trim() === lotNumber)!;
        statements.push(d1.prepare("INSERT INTO inventory_batches (id, tenant_id, item_id, lot_number, expires_on, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, item_id, lot_number) DO NOTHING").bind(batch.id, tenantId, itemId, lotNumber, line.expiresOn ?? null, now, now));
      }
    }
    statements.push(d1.prepare("INSERT INTO purchase_invoices (id, tenant_id, supplier_id, warehouse_id, operation_id, invoice_number, total_minor, paid_minor, status, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'received', ?, ?, ?)").bind(invoiceId, tenantId, input.supplierId, input.warehouseId, operationId, input.invoiceNumber, totalMinor, input.notes ?? null, now, access.context.user.id));
    for (const line of lines) {
      if (line.batchLotNumber) {
        statements.push(d1.prepare("INSERT INTO purchase_invoice_lines (id, tenant_id, purchase_invoice_id, item_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, quantity, unit_cost_minor, line_total_minor, created_at) SELECT ?, ?, ?, ?, b.id, ?, ?, ?, ?, ?, ?, ?, ? FROM inventory_batches b WHERE b.tenant_id = ? AND b.item_id = ? AND b.lot_number = ?").bind(line.id, tenantId, invoiceId, line.itemId, line.unitId, line.unitQuantity, line.unitCode, line.unitConversionFactor, line.quantity, line.unitCostMinor, line.lineTotalMinor, now, tenantId, line.itemId, line.batchLotNumber));
        statements.push(createBalanceStatementByLot(d1, { id: crypto.randomUUID(), tenantId, itemId: line.itemId, warehouseId: input.warehouseId, lotNumber: line.batchLotNumber }));
        statements.push(d1.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) SELECT ?, ?, ?, ?, ?, b.id, ?, ?, ?, ?, 'purchase_receipt', ?, ?, 'purchase_invoice', ?, ?, ?, ? FROM inventory_batches b WHERE b.tenant_id = ? AND b.item_id = ? AND b.lot_number = ?").bind(crypto.randomUUID(), tenantId, operationId, line.itemId, input.warehouseId, line.unitId, line.unitQuantity, line.unitCode, line.unitConversionFactor, line.quantity, line.unitCostMinor, invoiceId, `استلام فاتورة ${input.invoiceNumber}`, access.context.user.id, now, tenantId, line.itemId, line.batchLotNumber));
      } else {
        statements.push(d1.prepare("INSERT INTO purchase_invoice_lines (id, tenant_id, purchase_invoice_id, item_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, quantity, unit_cost_minor, line_total_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(line.id, tenantId, invoiceId, line.itemId, line.batchId, line.unitId, line.unitQuantity, line.unitCode, line.unitConversionFactor, line.quantity, line.unitCostMinor, line.lineTotalMinor, now));
        statements.push(createBalanceStatement(d1, { id: crypto.randomUUID(), tenantId, itemId: line.itemId, warehouseId: input.warehouseId, batchId: line.batchId }));
        statements.push(d1.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, unit_id, unit_quantity, unit_code_snapshot, unit_conversion_factor, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'purchase_receipt', ?, ?, 'purchase_invoice', ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, operationId, line.itemId, input.warehouseId, line.batchId, line.unitId, line.unitQuantity, line.unitCode, line.unitConversionFactor, line.quantity, line.unitCostMinor, invoiceId, `استلام فاتورة ${input.invoiceNumber}`, access.context.user.id, now));
      }
      statements.push(d1.prepare("UPDATE inventory_items SET default_cost_minor = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").bind(line.unitCostMinor, now, line.itemId, tenantId));
    }
    if (paidMinor > 0) statements.push(d1.prepare("INSERT INTO supplier_payments (id, tenant_id, supplier_id, purchase_invoice_id, idempotency_key, amount_minor, payment_method, reference, received_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, input.supplierId, invoiceId, `${input.idempotencyKey}:initial-payment`, paidMinor, input.paymentMethod, input.paymentReference ?? null, access.context.user.id, now));
    await d1.batch(statements);
    const purchase = await d1.prepare("SELECT id, invoice_number AS invoiceNumber, total_minor AS totalMinor, paid_minor AS paidMinor, status FROM purchase_invoices WHERE id = ? AND tenant_id = ? LIMIT 1").bind(invoiceId, tenantId).first();
    await writeAudit(access.context, request, "purchase.received", "purchase_invoice", invoiceId, { totalMinor, paidMinor, lines: lines.length });
    return Response.json({ purchase }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const existing = requestKey ? await d1.prepare("SELECT o.id, o.operation_type AS operationType, p.id AS invoiceId, p.invoice_number AS invoiceNumber, p.total_minor AS totalMinor, p.paid_minor AS paidMinor, p.status FROM stock_operations o LEFT JOIN purchase_invoices p ON p.operation_id = o.id AND p.tenant_id = o.tenant_id WHERE o.tenant_id = ? AND o.idempotency_key = ? LIMIT 1").bind(access.context.tenantId, requestKey).first<Record<string, unknown>>() : null;
    if (existing?.invoiceId) return Response.json({ purchase: { id: existing.invoiceId, invoiceNumber: existing.invoiceNumber, totalMinor: existing.totalMinor, paidMinor: existing.paidMinor, status: existing.status }, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    if (String(error).includes("INVENTORY_INSUFFICIENT_STOCK")) return Response.json({ error: "الرصيد غير كافٍ لتنفيذ الحركة" }, { status: 409 });
    if (String(error).includes("SUPPLIER_PAYMENT_EXCEEDS_BALANCE")) return Response.json({ error: "الدفعة تتجاوز رصيد فاتورة المورد" }, { status: 409 });
    if (String(error).includes("purchase_invoices_supplier_number_uq")) return Response.json({ error: "رقم فاتورة المورد مستخدم مسبقاً" }, { status: 409 });
    return errorResponse(error);
  }
}
