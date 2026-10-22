import { z } from "zod";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleWarehouseIds, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";

const chequeInput = z.object({
  purchaseInvoiceId: uuidSchema,
  chequeNumber: z.string().trim().min(1).max(80),
  bankName: z.string().trim().min(2).max(120),
  dueDate: z.string().date(),
  amount: moneySchema.gt(0).max(100_000_000),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ cheques: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const result = await access.context.env.DB.prepare(`SELECT c.id, c.supplier_id AS supplierId, s.name AS supplierName, c.purchase_invoice_id AS purchaseInvoiceId, p.invoice_number AS invoiceNumber, c.cheque_number AS chequeNumber, c.bank_name AS bankName, c.due_date AS dueDate, c.amount_minor AS amountMinor, c.status, c.notes, c.created_at AS createdAt, c.cashed_at AS cashedAt FROM supplier_cheques c JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id JOIN purchase_invoices p ON p.id = c.purchase_invoice_id AND p.tenant_id = c.tenant_id JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND p.warehouse_id IN (${placeholders}) ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.due_date ASC, c.created_at DESC LIMIT 300`).bind(access.context.tenantId, ...warehouseIds).all();
  return Response.json({ cheques: result.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  try {
    const parsed = chequeInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات شيك المورد وتاريخ الاستحقاق");
    const input = parsed.data;
    const purchase = await d1.prepare("SELECT p.supplier_id AS supplierId, p.warehouse_id AS warehouseId, p.total_minor AS totalMinor, p.paid_minor AS paidMinor, p.status, w.branch_id AS branchId FROM purchase_invoices p JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? LIMIT 1").bind(input.purchaseInvoiceId, access.context.tenantId).first<{ supplierId: string; warehouseId: string; totalMinor: number; paidMinor: number; status: string; branchId: string | null }>();
    if (!purchase || purchase.status !== "received") throw new ApiError("فاتورة المورد غير موجودة أو غير قابلة للسداد", 404);
    await requireWarehouseBranchMembership(access.context, purchase.branchId);
    const amountMinor = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new ApiError("مبلغ الشيك يجب أن يكون قرشاً صحيحاً واحداً على الأقل");
    const reserved = await d1.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM supplier_cheques WHERE tenant_id = ? AND purchase_invoice_id = ? AND status = 'pending'").bind(access.context.tenantId, input.purchaseInvoiceId).first<{ amount: number }>();
    if (amountMinor > purchase.totalMinor - purchase.paidMinor - Number(reserved?.amount ?? 0)) throw new ApiError("مبلغ الشيك يتجاوز الرصيد المتاح بعد الشيكات الصادرة المعلقة", 409);
    const id = crypto.randomUUID();
    const now = Date.now();
    await d1.prepare("INSERT INTO supplier_cheques (id, tenant_id, supplier_id, purchase_invoice_id, cheque_number, bank_name, due_date, amount_minor, status, notes, issued_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)").bind(id, access.context.tenantId, purchase.supplierId, input.purchaseInvoiceId, input.chequeNumber, input.bankName, input.dueDate, amountMinor, input.notes ?? null, access.context.user.id, now, now).run();
    const cheque = await d1.prepare("SELECT id, supplier_id AS supplierId, purchase_invoice_id AS purchaseInvoiceId, cheque_number AS chequeNumber, bank_name AS bankName, due_date AS dueDate, amount_minor AS amountMinor, status, created_at AS createdAt FROM supplier_cheques WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first();
    await writeAudit(access.context, request, "supplier_cheque.issued", "supplier_cheque", id, { supplierId: purchase.supplierId, purchaseInvoiceId: input.purchaseInvoiceId, amountMinor });
    return Response.json({ cheque }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("supplier_cheques_tenant_bank_number_uq") || String(error).includes("supplier_cheques.tenant_id, supplier_cheques.bank_name, supplier_cheques.cheque_number")) return Response.json({ error: "رقم الشيك مسجل مسبقاً لهذا البنك" }, { status: 409 });
    if (String(error).includes("SUPPLIER_CHECK_EXCEEDS_BALANCE")) return Response.json({ error: "مبلغ الشيك يتجاوز الرصيد المتاح بعد الشيكات المعلقة" }, { status: 409 });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  try {
    const parsed = z.object({ id: uuidSchema, status: z.enum(["cashed", "returned", "rejected"]) }).safeParse(await request.json());
    if (!parsed.success) throw new ApiError("اختر حالة صالحة للشيك");
    const { id, status } = parsed.data;
    const cheque = await d1.prepare("SELECT c.supplier_id AS supplierId, c.purchase_invoice_id AS purchaseInvoiceId, c.cheque_number AS chequeNumber, c.bank_name AS bankName, c.due_date AS dueDate, c.amount_minor AS amountMinor, c.status, w.branch_id AS branchId FROM supplier_cheques c JOIN purchase_invoices p ON p.id = c.purchase_invoice_id AND p.tenant_id = c.tenant_id JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = c.tenant_id WHERE c.id = ? AND c.tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first<{ supplierId: string; purchaseInvoiceId: string; chequeNumber: string; bankName: string; dueDate: string; amountMinor: number; status: string; branchId: string | null }>();
    if (!cheque) throw new ApiError("شيك المورد غير موجود", 404);
    await requireWarehouseBranchMembership(access.context, cheque.branchId);
    if (cheque.status === status) return Response.json({ cheque: { id, status: cheque.status } }, { headers: { "Cache-Control": "no-store" } });
    if (cheque.status !== "pending") throw new ApiError("يمكن تغيير حالة الشيك المعلق فقط؛ الحالات النهائية لا تُستبدل", 409);
    const now = Date.now();
    if (status === "cashed") {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: access.context.tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (cheque.dueDate > today) throw new ApiError("لا يمكن تسجيل صرف الشيك قبل تاريخ الاستحقاق", 409);
      const updateCheque = d1.prepare("UPDATE supplier_cheques SET status = 'cashed', status_updated_by = ?, cashed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'")
        .bind(access.context.user.id, now, now, id, access.context.tenantId);
      const insertPayment = d1.prepare("INSERT INTO supplier_payments (id, tenant_id, supplier_id, purchase_invoice_id, supplier_cheque_id, idempotency_key, amount_minor, payment_method, reference, received_by, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'cheque', ?, ?, ? WHERE changes() = 1")
        .bind(crypto.randomUUID(), access.context.tenantId, cheque.supplierId, cheque.purchaseInvoiceId, id, `supplier-cheque:${id}`, cheque.amountMinor, `شيك ${cheque.chequeNumber} · ${cheque.bankName}`, access.context.user.id, now);
      await d1.batch([updateCheque, insertPayment]);
    } else {
      await d1.prepare("UPDATE supplier_cheques SET status = ?, status_updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'").bind(status, access.context.user.id, now, id, access.context.tenantId).run();
    }
    const updated = await d1.prepare("SELECT id, status, cashed_at AS cashedAt FROM supplier_cheques WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first<{ id: string; status: string; cashedAt: number | null }>();
    if (!updated || updated.status !== status) throw new ApiError("تغير رصيد الفاتورة أو حالة الشيك بالتزامن؛ حدّث الصفحة وحاول مجدداً", 409);
    await writeAudit(access.context, request, `supplier_cheque.${status}`, "supplier_cheque", id, { supplierId: cheque.supplierId, purchaseInvoiceId: cheque.purchaseInvoiceId, amountMinor: cheque.amountMinor });
    return Response.json({ cheque: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("SUPPLIER_PAYMENT_EXCEEDS_BALANCE")) return Response.json({ error: "لم يعد في فاتورة المورد رصيد كافٍ لصرف الشيك" }, { status: 409 });
    if (String(error).includes("SUPPLIER_CHECK_PAYMENT_SCOPE")) return Response.json({ error: "تعذر ربط دفعة الشيك بفاتورة المورد؛ حدّث الصفحة وحاول مجدداً" }, { status: 409 });
    if (String(error).includes("supplier_payments_tenant_idempotency_uq") || String(error).includes("supplier_payments_cheque_uq")) return Response.json({ error: "تم تسجيل صرف هذا الشيك مسبقاً" }, { status: 409 });
    return errorResponse(error);
  }
}
