import { z } from "zod";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";

const chequeInput = z.object({
  branchId: uuidSchema,
  customerId: uuidSchema,
  invoiceId: uuidSchema.nullable().optional(),
  chequeNumber: z.string().trim().min(1).max(80),
  bankName: z.string().trim().min(2).max(120),
  dueDate: z.string().date(),
  amount: moneySchema.gt(0).max(100_000_000),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const branchIds = await getAccessibleBranchIds(access.context);
  if (!branchIds.length) return Response.json({ cheques: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = branchIds.map(() => "?").join(",");
  const result = await access.context.env.DB.prepare(`SELECT c.id, c.branch_id AS branchId, c.customer_id AS customerId, cu.full_name AS customerName, c.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, c.cheque_number AS chequeNumber, c.bank_name AS bankName, c.due_date AS dueDate, c.amount_minor AS amountMinor, c.status, c.status_reason AS statusReason, c.notes, c.created_at AS createdAt, c.collected_at AS collectedAt FROM customer_cheques c JOIN customers cu ON cu.id = c.customer_id AND cu.tenant_id = c.tenant_id LEFT JOIN invoices i ON i.id = c.invoice_id AND i.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.branch_id IN (${placeholders}) ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'collected' THEN 1 ELSE 2 END, c.due_date ASC, c.created_at DESC LIMIT 300`).bind(access.context.tenantId, ...branchIds).all();
  return Response.json({ cheques: result.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  try {
    const parsed = chequeInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات شيك العميل وتاريخ استحقاقه");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const customer = await d1.prepare("SELECT c.id, c.branch_id AS branchId, EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id AND a.branch_id = ?) AS hasBranchVisit FROM customers c WHERE c.id = ? AND c.tenant_id = ? LIMIT 1").bind(input.branchId, input.customerId, access.context.tenantId).first<{ id: string; branchId: string | null; hasBranchVisit: number }>();
    if (!customer || (customer.branchId !== input.branchId && customer.hasBranchVisit !== 1)) throw new ApiError("العميل غير موجود في نطاق الفرع المحدد", 404);
    const amountMinor = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new ApiError("مبلغ الشيك يجب أن يكون قرشاً صحيحاً واحداً على الأقل");
    if (input.invoiceId) {
      const invoice = await d1.prepare("SELECT id, status, total_minor AS totalMinor, paid_minor AS paidMinor FROM invoices WHERE id = ? AND tenant_id = ? AND customer_id = ? AND branch_id = ? LIMIT 1").bind(input.invoiceId, access.context.tenantId, input.customerId, input.branchId).first<{ id: string; status: string; totalMinor: number; paidMinor: number }>();
      if (!invoice || !["issued", "partially_paid"].includes(invoice.status)) throw new ApiError("الفاتورة غير موجودة أو لا تقبل دفعات", 404);
      const reserved = await d1.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM customer_cheques WHERE tenant_id = ? AND invoice_id = ? AND status = 'pending'").bind(access.context.tenantId, input.invoiceId).first<{ amount: number }>();
      if (amountMinor > invoice.totalMinor - invoice.paidMinor - Number(reserved?.amount ?? 0)) throw new ApiError("مبلغ الشيك يتجاوز الرصيد المتاح بعد الشيكات المعلقة", 409);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await d1.prepare("INSERT INTO customer_cheques (id, tenant_id, branch_id, customer_id, invoice_id, cheque_number, bank_name, due_date, amount_minor, status, notes, received_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)").bind(id, access.context.tenantId, input.branchId, input.customerId, input.invoiceId ?? null, input.chequeNumber, input.bankName, input.dueDate, amountMinor, input.notes ?? null, access.context.user.id, now, now).run();
    const cheque = await d1.prepare("SELECT id, customer_id AS customerId, invoice_id AS invoiceId, cheque_number AS chequeNumber, bank_name AS bankName, due_date AS dueDate, amount_minor AS amountMinor, status, created_at AS createdAt FROM customer_cheques WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first();
    await writeAudit(access.context, request, "customer_cheque.received", "customer_cheque", id, { customerId: input.customerId, invoiceId: input.invoiceId ?? null, amountMinor });
    return Response.json({ cheque }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("customer_cheques_tenant_bank_number_uq") || String(error).includes("customer_cheques.tenant_id, customer_cheques.bank_name, customer_cheques.cheque_number")) return Response.json({ error: "رقم الشيك مسجل مسبقاً لهذا البنك" }, { status: 409 });
    if (String(error).includes("CUSTOMER_CHECK_INVOICE_SCOPE_OR_BALANCE")) return Response.json({ error: "الفاتورة لم تعد تملك رصيداً كافياً لتخصيص الشيك" }, { status: 409 });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const d1 = access.context.env.DB;
  try {
    const parsed = z.object({ id: uuidSchema, status: z.enum(["collected", "returned", "rejected"]), reason: z.string().trim().max(300).optional() }).safeParse(await request.json());
    if (!parsed.success) throw new ApiError("اختر حالة صالحة للشيك");
    const { id } = parsed.data;
    const cheque = await d1.prepare("SELECT branch_id AS branchId, customer_id AS customerId, invoice_id AS invoiceId, cheque_number AS chequeNumber, due_date AS dueDate, amount_minor AS amountMinor, status FROM customer_cheques WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first<{ branchId: string; customerId: string; invoiceId: string | null; chequeNumber: string; dueDate: string; amountMinor: number; status: string }>();
    if (!cheque) throw new ApiError("شيك العميل غير موجود", 404);
    await requireBranchMembership(access.context, cheque.branchId);
    if (cheque.status === parsed.data.status) return Response.json({ cheque: { id, status: cheque.status } }, { headers: { "Cache-Control": "no-store" } });
    const reversingCollectedCheque = cheque.status === "collected" && ["returned", "rejected"].includes(parsed.data.status);
    if (cheque.status !== "pending" && !reversingCollectedCheque) throw new ApiError("لا يمكن تنفيذ هذا الانتقال لحالة الشيك الحالية", 409);
    const now = Date.now();
    if (parsed.data.status === "collected") {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: access.context.tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (cheque.dueDate > today) throw new ApiError("لا يمكن تسجيل تحصيل الشيك قبل تاريخ الاستحقاق", 409);
    }
    if (reversingCollectedCheque) {
      const adjustedSettlementId = crypto.randomUUID();
      const reason = parsed.data.reason || (parsed.data.status === "returned" ? "ارتداد شيك العميل بعد التحصيل" : "رفض شيك العميل بعد التحصيل");
      if (!cheque.invoiceId) {
        await d1.prepare("UPDATE customer_cheques SET status = ?, status_reason = ?, status_updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'collected' AND invoice_id IS NULL")
          .bind(parsed.data.status, reason, access.context.user.id, now, id, access.context.tenantId).run();
      } else {
      const reversePayment = d1.prepare("UPDATE invoice_payments SET reversed_at = ?, reversed_by = ?, reversal_reason = ? WHERE tenant_id = ? AND customer_cheque_id = ? AND reversed_at IS NULL AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_payments.invoice_id AND i.tenant_id = invoice_payments.tenant_id AND i.paid_minor >= invoice_payments.amount_minor AND i.status IN ('paid','partially_paid'))")
        .bind(now, access.context.user.id, reason, access.context.tenantId, id);
      const reverseInvoice = d1.prepare("UPDATE invoices SET paid_minor = paid_minor - ?, status = CASE WHEN paid_minor - ? <= 0 THEN 'issued' WHEN paid_minor - ? >= total_minor THEN 'paid' ELSE 'partially_paid' END, paid_at = CASE WHEN paid_minor - ? >= total_minor THEN paid_at ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('paid','partially_paid') AND paid_minor >= ? AND changes() = 1 AND EXISTS (SELECT 1 FROM invoice_payments p WHERE p.tenant_id = ? AND p.invoice_id = invoices.id AND p.customer_cheque_id = ? AND p.amount_minor = ? AND p.reversed_at = ?)")
        .bind(cheque.amountMinor, cheque.amountMinor, cheque.amountMinor, cheque.amountMinor, now, cheque.invoiceId, access.context.tenantId, cheque.amountMinor, access.context.tenantId, id, cheque.amountMinor, now);
      const refreshMethod = d1.prepare("UPDATE invoices SET payment_method = CASE WHEN NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.tenant_id = ? AND p.invoice_id = invoices.id AND p.reversed_at IS NULL) THEN 'unpaid' WHEN (SELECT COUNT(DISTINCT p.payment_method) FROM invoice_payments p WHERE p.tenant_id = ? AND p.invoice_id = invoices.id AND p.reversed_at IS NULL) = 1 THEN (SELECT MIN(p.payment_method) FROM invoice_payments p WHERE p.tenant_id = ? AND p.invoice_id = invoices.id AND p.reversed_at IS NULL) ELSE 'mixed' END WHERE id = ? AND tenant_id = ? AND changes() = 1")
        .bind(access.context.tenantId, access.context.tenantId, access.context.tenantId, cheque.invoiceId, access.context.tenantId);
      const updateCheque = d1.prepare("UPDATE customer_cheques SET status = ?, status_reason = ?, status_updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'collected' AND changes() = 1")
        .bind(parsed.data.status, reason, access.context.user.id, now, id, access.context.tenantId);
      const adjustClosedShift = d1.prepare("INSERT INTO shift_settlement_adjustments (id, tenant_id, settlement_id, payment_method, amount_delta_minor, reason, created_by, created_at) SELECT ?, ?, s.id, 'cheque', ?, ?, ?, ? FROM shift_settlements s WHERE s.tenant_id = ? AND s.branch_id = ? AND s.status = 'closed' AND changes() = 1 AND EXISTS (SELECT 1 FROM invoice_payments p WHERE p.tenant_id = s.tenant_id AND p.invoice_id = ? AND p.customer_cheque_id = ? AND p.reversed_at = ? AND p.created_at >= s.opened_at AND p.created_at <= CASE WHEN s.closed_at < 1000000000000 THEN s.closed_at * 1000 ELSE s.closed_at END) ORDER BY s.closed_at DESC LIMIT 1")
        .bind(adjustedSettlementId, access.context.tenantId, -cheque.amountMinor, reason, access.context.user.id, now, access.context.tenantId, cheque.branchId, cheque.invoiceId, id, now);
      await d1.batch([reversePayment, reverseInvoice, refreshMethod, updateCheque, adjustClosedShift]);
      }
    } else if (parsed.data.status !== "collected" || !cheque.invoiceId) {
      const reason = parsed.data.reason || (parsed.data.status === "returned" ? "ارتداد من البنك" : parsed.data.status === "rejected" ? "رفض من البنك" : null);
      await d1.prepare("UPDATE customer_cheques SET status = ?, status_reason = ?, status_updated_by = ?, collected_at = CASE WHEN ? = 'collected' THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'").bind(parsed.data.status, reason, access.context.user.id, parsed.data.status, now, now, id, access.context.tenantId).run();
    } else {
      const paymentId = crypto.randomUUID();
      const updateInvoice = d1.prepare("UPDATE invoices SET paid_minor = paid_minor + ?, payment_method = CASE WHEN paid_minor = 0 THEN 'cheque' WHEN payment_method = 'cheque' THEN payment_method ELSE 'mixed' END, status = CASE WHEN paid_minor + ? >= total_minor THEN 'paid' ELSE 'partially_paid' END, paid_at = CASE WHEN paid_minor + ? >= total_minor THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('issued', 'partially_paid') AND paid_minor + ? <= total_minor - COALESCE((SELECT SUM(c.amount_minor) FROM customer_cheques c WHERE c.tenant_id = ? AND c.invoice_id = ? AND c.status = 'pending' AND c.id <> ?), 0)")
        .bind(cheque.amountMinor, cheque.amountMinor, cheque.amountMinor, now, now, cheque.invoiceId, access.context.tenantId, cheque.amountMinor, access.context.tenantId, cheque.invoiceId, id);
      const insertPayment = d1.prepare("INSERT INTO invoice_payments (id, tenant_id, invoice_id, received_by, amount_minor, payment_method, reference, idempotency_key, customer_cheque_id, created_at) SELECT ?, ?, ?, ?, ?, 'cheque', ?, ?, ?, ? WHERE changes() = 1")
        .bind(paymentId, access.context.tenantId, cheque.invoiceId, access.context.user.id, cheque.amountMinor, `شيك ${cheque.chequeNumber}`, `customer-cheque:${id}`, id, now);
      const updateCheque = d1.prepare("UPDATE customer_cheques SET status = 'collected', status_updated_by = ?, collected_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending' AND changes() = 1")
        .bind(access.context.user.id, now, now, id, access.context.tenantId);
      await d1.batch([updateInvoice, insertPayment, updateCheque]);
    }
    const updated = await d1.prepare("SELECT id, status, status_reason AS statusReason, collected_at AS collectedAt FROM customer_cheques WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.context.tenantId).first<{ id: string; status: string; statusReason: string | null; collectedAt: number | null }>();
    if (!updated || updated.status !== parsed.data.status) throw new ApiError("تغير رصيد الفاتورة أو حالة الشيك بالتزامن؛ حدّث الصفحة وحاول مجدداً", 409);
    await writeAudit(access.context, request, `customer_cheque.${parsed.data.status}`, "customer_cheque", id, { customerId: cheque.customerId, invoiceId: cheque.invoiceId, amountMinor: cheque.amountMinor, reason: updated.statusReason, paymentReversed: reversingCollectedCheque });
    return Response.json({ cheque: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("invoice_payments_customer_cheque_uq") || String(error).includes("invoice_payments_tenant_idempotency_uq")) return Response.json({ error: "تم تسجيل تحصيل هذا الشيك مسبقاً" }, { status: 409 });
    if (String(error).includes("CUSTOMER_CHECK_EXCEEDS_INVOICE_BALANCE") || String(error).includes("CUSTOMER_CHECK_PAYMENT_MISSING")) return Response.json({ error: "تعذر تحصيل الشيك بسبب تغير رصيد الفاتورة؛ حدّث الصفحة وحاول مجدداً" }, { status: 409 });
    if (String(error).includes("CUSTOMER_CHECK_REVERSAL_")) return Response.json({ error: "تعذر عكس قيد الشيك بسبب تغير رصيد الفاتورة أو حالة الدفعة؛ حدّث الصفحة وحاول مجدداً" }, { status: 409 });
    return errorResponse(error);
  }
}
