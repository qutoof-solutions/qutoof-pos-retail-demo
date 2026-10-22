import { z } from "zod";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleWarehouseIds, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const paymentSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(120), purchaseInvoiceId: uuidSchema, amount: moneySchema.gt(0).max(100_000_000), paymentMethod: z.enum(["cash", "bank", "wallet", "instapay"]), reference: z.string().trim().max(160).nullable().optional() });

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const { id } = await route.params;
  if (!uuidSchema.safeParse(id).success) return Response.json({ error: "معرف المورد غير صالح" }, { status: 400 });
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ payments: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const payments = await access.context.env.DB.prepare(`SELECT sp.id, sp.purchase_invoice_id AS purchaseInvoiceId, p.invoice_number AS invoiceNumber, sp.amount_minor AS amountMinor, sp.payment_method AS paymentMethod, sp.reference, sp.created_at AS createdAt, u.full_name AS receivedBy FROM supplier_payments sp JOIN purchase_invoices p ON p.id = sp.purchase_invoice_id AND p.tenant_id = sp.tenant_id LEFT JOIN users u ON u.id = sp.received_by AND u.tenant_id = sp.tenant_id WHERE sp.tenant_id = ? AND sp.supplier_id = ? AND p.warehouse_id IN (${placeholders}) ORDER BY sp.created_at DESC LIMIT 200`).bind(access.context.tenantId, id, ...warehouseIds).all();
  return Response.json({ payments: payments.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const { id: supplierId } = await route.params;
  const d1 = access.context.env.DB;
  try {
    if (!uuidSchema.safeParse(supplierId).success) throw new ApiError("معرف المورد غير صالح");
    const parsed = paymentSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات الدفعة ومرجع فاتورة المورد");
    const input = parsed.data;
    const purchase = await d1.prepare("SELECT supplier_id AS supplierId, warehouse_id AS warehouseId FROM purchase_invoices WHERE id = ? AND tenant_id = ? LIMIT 1").bind(input.purchaseInvoiceId, access.context.tenantId).first<{ supplierId: string; warehouseId: string }>();
    if (!purchase || purchase.supplierId !== supplierId) throw new ApiError("فاتورة الشراء لا تخص هذا المورد", 404);
    const warehouse = await d1.prepare("SELECT branch_id AS branchId FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1").bind(purchase.warehouseId, access.context.tenantId).first<{ branchId: string | null }>();
    await requireWarehouseBranchMembership(access.context, warehouse?.branchId ?? null);
    const existing = await d1.prepare("SELECT id, supplier_id AS supplierId, purchase_invoice_id AS purchaseInvoiceId, amount_minor AS amountMinor FROM supplier_payments WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(access.context.tenantId, input.idempotencyKey).first<{ id: string; supplierId: string; purchaseInvoiceId: string; amountMinor: number }>();
    if (existing) {
      if (existing.supplierId !== supplierId || existing.purchaseInvoiceId !== input.purchaseInvoiceId || existing.amountMinor !== Math.round(input.amount * 100)) throw new ApiError("مفتاح الدفعة مستخدم لعملية مختلفة", 409);
      return Response.json({ payment: existing, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const amountMinor = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new ApiError("يجب أن تكون الدفعة قرشاً صحيحاً واحداً على الأقل");
    const id = crypto.randomUUID();
    await d1.batch([d1.prepare("INSERT INTO supplier_payments (id, tenant_id, supplier_id, purchase_invoice_id, idempotency_key, amount_minor, payment_method, reference, received_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())").bind(id, access.context.tenantId, supplierId, input.purchaseInvoiceId, input.idempotencyKey, amountMinor, input.paymentMethod, input.reference ?? null, access.context.user.id)]);
    const payment = await d1.prepare("SELECT id, purchase_invoice_id AS purchaseInvoiceId, amount_minor AS amountMinor, payment_method AS paymentMethod, reference, created_at AS createdAt FROM supplier_payments WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first();
    await writeAudit(access.context, request, "supplier.payment_recorded", "supplier_payment", id, { supplierId, purchaseInvoiceId: input.purchaseInvoiceId, amountMinor });
    return Response.json({ payment }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("SUPPLIER_PAYMENT_EXCEEDS_BALANCE")) return Response.json({ error: "الدفعة تتجاوز الرصيد المتبقي في فاتورة المورد" }, { status: 409 });
    if (String(error).includes("SUPPLIER_PAYMENT_RESERVED_FOR_CHECK")) return Response.json({ error: "جزء من رصيد الفاتورة محجوز لشيك مورد معلق" }, { status: 409 });
    if (String(error).includes("supplier_payments_tenant_idempotency_uq")) {
      const input = await request.clone().json().catch(() => null) as { idempotencyKey?: string } | null;
      const payment = input?.idempotencyKey ? await d1.prepare("SELECT id, amount_minor AS amountMinor FROM supplier_payments WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(access.context.tenantId, input.idempotencyKey).first() : null;
      if (payment) return Response.json({ payment, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return errorResponse(error);
  }
}
