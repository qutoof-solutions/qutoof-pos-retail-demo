import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { installmentContracts, installmentSchedules, invoicePayments, invoices } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { applyInvoicePayment } from "@/lib/operations/invoice-payment";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const paymentInput = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  amount: z.number().finite().gt(0).max(10_000_000),
  method: z.enum(["cash", "card", "wallet", "instapay"]),
  reference: z.string().trim().max(160).nullable().optional(),
});

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  let requestKey = "";
  let requestHash = "";
  let invoiceId = "";
  try {
    const { id } = await route.params;
    invoiceId = id;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "معرّف الفاتورة غير صالح" }, { status: 400 });
    const [scopeInvoice] = await access.context.db.select({ id: invoices.id, branchId: invoices.branchId }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, access.context.tenantId))).limit(1);
    if (!scopeInvoice) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    await requireBranchMembership(access.context, scopeInvoice.branchId);
    const parsed = paymentInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من مبلغ وطريقة الدفع");
    const amountMinor = Math.round(parsed.data.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new ApiError("يجب أن يكون مبلغ الدفعة قرشاً واحداً على الأقل");
    const { db, tenantId, user } = access.context;
    requestKey = parsed.data.idempotencyKey;
    requestHash = await payloadFingerprint({ invoiceId: id, amountMinor, method: parsed.data.method, reference: parsed.data.reference ?? null });
    const [existingPayment] = await db.select({ id: invoicePayments.id, invoiceId: invoicePayments.invoiceId, payloadHash: invoicePayments.idempotencyPayloadHash }).from(invoicePayments).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.idempotencyKey, requestKey))).limit(1);
    if (existingPayment) {
      if (existingPayment.invoiceId !== id || existingPayment.payloadHash !== requestHash) throw new ApiError("مفتاح الدفعة مستخدم لعملية دفع مختلفة؛ أنشئ عملية جديدة", 409);
      const [currentInvoice] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, paymentMethod: invoices.paymentMethod, status: invoices.status }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).limit(1);
      return Response.json({ invoice: currentInvoice, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const [invoice] = await db.select({ id: invoices.id, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, status: invoices.status }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).limit(1);
    if (!invoice) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    if (!["issued", "partially_paid"].includes(invoice.status)) return Response.json({ error: "لا يمكن إضافة دفعة إلى هذه الفاتورة" }, { status: 409 });
    const result = await applyInvoicePayment({ db: access.context.env.DB, tenantId, invoiceId: id, userId: user.id, amountMinor, method: parsed.data.method, reference: parsed.data.reference ?? null, idempotencyKey: requestKey, payloadHash: requestHash });
    const [updated] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, paymentMethod: invoices.paymentMethod, status: invoices.status }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).limit(1);
    if (!result.replayed) {
      const [contract] = await db.select({ id: installmentContracts.id }).from(installmentContracts).where(and(eq(installmentContracts.invoiceId, id), eq(installmentContracts.tenantId, tenantId), eq(installmentContracts.status, "active"))).limit(1);
      if (contract) {
        const [unpaid] = await db.select({ id: installmentSchedules.id }).from(installmentSchedules).where(and(eq(installmentSchedules.contractId, contract.id), eq(installmentSchedules.tenantId, tenantId), eq(installmentSchedules.status, "unpaid"))).limit(1);
        if (!unpaid) await db.update(installmentContracts).set({ status: "completed", updatedAt: new Date() }).where(and(eq(installmentContracts.id, contract.id), eq(installmentContracts.tenantId, tenantId)));
      }
    }
    await writeAudit(access.context, request, "invoice.payment_recorded", "invoice", id, { amountMinor, method: parsed.data.method });
    return Response.json({ invoice: updated, ...(result.replayed ? { replayed: true } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (requestKey && requestHash && invoiceId) {
      const [existingPayment] = await access.context.db.select({ invoiceId: invoicePayments.invoiceId, payloadHash: invoicePayments.idempotencyPayloadHash }).from(invoicePayments).where(and(eq(invoicePayments.tenantId, access.context.tenantId), eq(invoicePayments.idempotencyKey, requestKey))).limit(1);
      if (existingPayment) {
        if (existingPayment.invoiceId !== invoiceId || existingPayment.payloadHash !== requestHash) return Response.json({ error: "مفتاح الدفعة مستخدم لعملية دفع مختلفة؛ أنشئ عملية جديدة" }, { status: 409 });
        const [currentInvoice] = await access.context.db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, paymentMethod: invoices.paymentMethod, status: invoices.status }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, access.context.tenantId))).limit(1);
        return Response.json({ invoice: currentInvoice, replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if (String(error).includes("INVOICE_PAYMENT_RESERVED_FOR_CHECK")) return Response.json({ error: "المبلغ المطلوب محجوز لشيك عميل معلق؛ حدّث الرصيد وحاول مجدداً" }, { status: 409 });
    return errorResponse(error);
  }
}
