import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { installmentContracts, installmentSchedules, invoicePayments } from "@/lib/db/schema";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { applyInvoicePayment } from "@/lib/operations/invoice-payment";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const paymentInput = z.object({ idempotencyKey: z.string().trim().min(8).max(120), scheduleId: uuidSchema, amount: moneySchema.gt(0).max(10_000_000), method: z.enum(["cash", "card", "wallet", "instapay"]), reference: z.string().trim().max(160).nullable().optional() });


export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  let requestKey = "";
  let requestHash = "";
  try {
    const { id: contractId } = await route.params;
    if (!uuidSchema.safeParse(contractId).success) return Response.json({ error: "معرف عقد التقسيط غير صالح" }, { status: 400 });
    const parsed = paymentInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات تحصيل القسط");
    const input = parsed.data;
    const [contract] = await access.context.db.select().from(installmentContracts).where(and(eq(installmentContracts.id, contractId), eq(installmentContracts.tenantId, access.context.tenantId))).limit(1);
    if (!contract) return Response.json({ error: "عقد التقسيط غير موجود" }, { status: 404 });
    if (contract.status !== "active") throw new ApiError("لا يمكن التحصيل من عقد غير نشط", 409);
    if (!contract.branchId) throw new ApiError("العقد غير مرتبط بفرع", 409);
    await requireBranchMembership(access.context, contract.branchId);
    const [schedule] = await access.context.db.select().from(installmentSchedules).where(and(eq(installmentSchedules.id, input.scheduleId), eq(installmentSchedules.contractId, contractId), eq(installmentSchedules.tenantId, access.context.tenantId))).limit(1);
    if (!schedule) return Response.json({ error: "القسط غير موجود" }, { status: 404 });
    if (schedule.status === "paid") throw new ApiError("تم سداد هذا القسط بالفعل", 409);
    const amountMinor = Math.round(input.amount * 100);
    const remainingMinor = schedule.amountMinor - schedule.paidMinor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > remainingMinor) throw new ApiError("مبلغ التحصيل أكبر من المتبقي للقسط", 409);
    requestKey = input.idempotencyKey;
    requestHash = await payloadFingerprint({ contractId, scheduleId: input.scheduleId, amountMinor, method: input.method, reference: input.reference ?? null });
    const { db, env, tenantId, user } = access.context;
    const [existing] = await db.select({ id: invoicePayments.id, invoiceId: invoicePayments.invoiceId, payloadHash: invoicePayments.idempotencyPayloadHash }).from(invoicePayments).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.idempotencyKey, requestKey))).limit(1);
    if (existing) {
      if (existing.invoiceId !== contract.invoiceId || existing.payloadHash !== requestHash) throw new ApiError("مفتاح التحصيل مستخدم لعملية مختلفة", 409);
      return Response.json({ schedule, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const now = new Date();
    const result = await applyInvoicePayment({ db: env.DB, tenantId, invoiceId: contract.invoiceId, userId: user.id, amountMinor, method: input.method, reference: input.reference ?? null, idempotencyKey: requestKey, payloadHash: requestHash, scheduleId: schedule.id, now });
    const [updatedSchedule] = await db.select().from(installmentSchedules).where(and(eq(installmentSchedules.id, schedule.id), eq(installmentSchedules.tenantId, tenantId))).limit(1);
    const [unpaid] = await db.select({ id: installmentSchedules.id }).from(installmentSchedules).where(and(eq(installmentSchedules.tenantId, tenantId), eq(installmentSchedules.contractId, contractId), eq(installmentSchedules.status, "unpaid"))).limit(1);
    if (!unpaid && !result.replayed) await db.update(installmentContracts).set({ status: "completed", updatedAt: now }).where(and(eq(installmentContracts.id, contractId), eq(installmentContracts.tenantId, tenantId)));
    await writeAudit(access.context, request, "installment.payment_recorded", "installment_contract", contractId, { scheduleId: schedule.id, amountMinor, method: input.method });
    return Response.json({ schedule: updatedSchedule, completed: !unpaid, ...(result.replayed ? { replayed: true } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
