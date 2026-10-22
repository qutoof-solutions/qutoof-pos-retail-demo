import { and, countDistinct, desc, eq, gte, inArray, isNull, lt, ne, sum } from "drizzle-orm";
import { z } from "zod";
import { branches, invoicePayments, invoices, shiftSettlementAdjustments, shiftSettlementLines, shiftSettlements, zReportSnapshots } from "@/lib/db/schema";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { createZReportSnapshot } from "@/lib/operations/z-report";

export const runtime = "edge";
const methods = ["cash", "card", "wallet", "instapay", "cheque"] as const;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), branchId: uuidSchema, openingCash: moneySchema.max(10_000_000), notes: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal("close"), settlementId: uuidSchema, countedCash: moneySchema.max(10_000_000), countedElectronic: z.record(z.enum(methods), moneySchema.max(10_000_000)).optional(), notes: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal("reverse"), settlementId: uuidSchema, paymentMethod: z.enum(methods), amount: moneySchema.max(10_000_000), reason: z.string().trim().min(3).max(500) }),
]);

type Method = typeof methods[number];
async function branchFor(access: Awaited<ReturnType<typeof requireOperationAccess>>, branchId: string) {
  if (!access.ok) return null;
  const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, access.context.tenantId))).limit(1);
  return branch ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId || !uuidSchema.safeParse(branchId).success) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  if (!await branchFor(access, branchId)) return Response.json({ error: "الفرع غير موجود" }, { status: 404 });
  await requireBranchMembership(access.context, branchId);
  const settlements = await access.context.db.select().from(shiftSettlements).where(and(eq(shiftSettlements.tenantId, access.context.tenantId), eq(shiftSettlements.branchId, branchId))).orderBy(desc(shiftSettlements.openedAt)).limit(30);
  const ids = settlements.map((row) => row.id);
  const [lines, adjustments, snapshots] = ids.length ? await Promise.all([
    access.context.db.select().from(shiftSettlementLines).where(and(eq(shiftSettlementLines.tenantId, access.context.tenantId), inArray(shiftSettlementLines.settlementId, ids))),
    access.context.db.select().from(shiftSettlementAdjustments).where(and(eq(shiftSettlementAdjustments.tenantId, access.context.tenantId), inArray(shiftSettlementAdjustments.settlementId, ids))).orderBy(desc(shiftSettlementAdjustments.createdAt)),
    access.context.db.select().from(zReportSnapshots).where(and(eq(zReportSnapshots.tenantId, access.context.tenantId), inArray(zReportSnapshots.settlementId, ids))),
  ]) : [[], [], []];
  return Response.json({ open: settlements.find((row) => row.status === "open") ?? null, history: settlements.filter((row) => row.status === "closed").map((row) => {
    const snapshot = snapshots.find((item) => item.settlementId === row.id);
    return { ...row, lines: lines.filter((line) => line.settlementId === row.id), adjustments: adjustments.filter((item) => item.settlementId === row.id), zReportSnapshot: snapshot ? { id: snapshot.id, payloadHash: snapshot.payloadHash, snapshotJson: snapshot.snapshotJson, createdAt: snapshot.createdAt } : null };
  }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات الوردية");
    const input = parsed.data;
    const { db, tenantId, env } = access.context;
    if (input.action === "open") {
      await requireBranchMembership(access.context, input.branchId);
      const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, tenantId), eq(branches.isActive, true))).limit(1);
      if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط", 404);
      const [existing] = await db.select({ id: shiftSettlements.id }).from(shiftSettlements).where(and(eq(shiftSettlements.tenantId, tenantId), eq(shiftSettlements.branchId, input.branchId), eq(shiftSettlements.status, "open"))).limit(1);
      if (existing) throw new ApiError("توجد وردية مفتوحة بالفعل لهذا الفرع", 409);
      const id = crypto.randomUUID();
      const [settlement] = await db.insert(shiftSettlements).values({ id, tenantId, branchId: input.branchId, openedBy: access.context.user.id, status: "open", openedAt: new Date(), openingCashMinor: Math.round(input.openingCash * 100), expectedCashMinor: Math.round(input.openingCash * 100), electronicTotalMinor: 0, notes: input.notes ?? null }).returning();
      await writeAudit(access.context, request, "shift.opened", "shift_settlement", id, { branchId: input.branchId });
      return Response.json({ settlement }, { status: 201 });
    }
    if (input.action === "reverse") {
      if (access.context.session.role !== "owner" && access.context.session.role !== "admin") throw new ApiError("التصحيح العكسي متاح للمالك أو المدير فقط", 403);
      const amountMinor = Math.round(input.amount * 100);
      const [shift] = await db.select({ id: shiftSettlements.id, branchId: shiftSettlements.branchId, status: shiftSettlements.status }).from(shiftSettlements).where(and(eq(shiftSettlements.id, input.settlementId), eq(shiftSettlements.tenantId, tenantId))).limit(1);
      if (!shift || shift.status !== "closed") throw new ApiError("لا يمكن تصحيح وردية غير مقفلة", 409);
      await requireBranchMembership(access.context, shift.branchId);
      const id = crypto.randomUUID();
      await db.insert(shiftSettlementAdjustments).values({ id, tenantId, settlementId: input.settlementId, paymentMethod: input.paymentMethod, amountDeltaMinor: -amountMinor, reason: input.reason, createdBy: access.context.user.id, createdAt: new Date() });
      await writeAudit(access.context, request, "shift.reversed", "shift_settlement", input.settlementId, { adjustmentId: id, paymentMethod: input.paymentMethod, amountDeltaMinor: -amountMinor, reason: input.reason });
      return Response.json({ adjustmentId: id }, { status: 201 });
    }
    const [openShift] = await db.select().from(shiftSettlements).where(and(eq(shiftSettlements.id, input.settlementId), eq(shiftSettlements.tenantId, tenantId), eq(shiftSettlements.status, "open"))).limit(1);
    if (!openShift?.branchId) throw new ApiError("الوردية المفتوحة غير موجودة أو غير مرتبطة بفرع", 404);
    const branchId = openShift.branchId;
    await requireBranchMembership(access.context, branchId);
    const now = new Date();
    const cashRows = await db.select({ total: sum(invoicePayments.amountMinor), count: countDistinct(invoices.id) }).from(invoicePayments).innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId))).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoices.branchId, branchId), eq(invoicePayments.paymentMethod, "cash"), isNull(invoicePayments.reversedAt), ne(invoices.status, "void"), gte(invoicePayments.createdAt, openShift.openedAt), lt(invoicePayments.createdAt, now)));
    const electronicRows = await Promise.all(methods.filter((method) => method !== "cash").map(async (method) => {
      const [row] = await db.select({ total: sum(invoicePayments.amountMinor), count: countDistinct(invoices.id) }).from(invoicePayments).innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId))).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoices.branchId, branchId), eq(invoicePayments.paymentMethod, method), isNull(invoicePayments.reversedAt), ne(invoices.status, "void"), gte(invoicePayments.createdAt, openShift.openedAt), lt(invoicePayments.createdAt, now)));
      return { method, total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
    }));
    const collected: Record<Method, number> = { cash: Number(cashRows[0]?.total ?? 0), card: electronicRows.find((row) => row.method === "card")?.total ?? 0, wallet: electronicRows.find((row) => row.method === "wallet")?.total ?? 0, instapay: electronicRows.find((row) => row.method === "instapay")?.total ?? 0, cheque: electronicRows.find((row) => row.method === "cheque")?.total ?? 0 };
    const counted: Record<Method, number> = { cash: Math.round(input.countedCash * 100), card: Math.round((input.countedElectronic?.card ?? collected.card / 100) * 100), wallet: Math.round((input.countedElectronic?.wallet ?? collected.wallet / 100) * 100), instapay: Math.round((input.countedElectronic?.instapay ?? collected.instapay / 100) * 100), cheque: Math.round((input.countedElectronic?.cheque ?? collected.cheque / 100) * 100) };
    const expectedCashMinor = openShift.openingCashMinor + collected.cash;
    const electronicTotalMinor = collected.card + collected.wallet + collected.instapay + collected.cheque;
    const timestamp = now.getTime();
    const closed = await env.DB.batch([
      env.DB.prepare("UPDATE shift_settlements SET status = 'closed', closed_by = ?, closed_at = ?, expected_cash_minor = ?, counted_cash_minor = ?, cash_difference_minor = ?, electronic_total_minor = ?, notes = ? WHERE id = ? AND tenant_id = ? AND status = 'open'").bind(access.context.user.id, timestamp, expectedCashMinor, counted.cash, counted.cash - expectedCashMinor, electronicTotalMinor, input.notes ?? openShift.notes, openShift.id, tenantId),
      ...methods.map((method) => env.DB.prepare("INSERT INTO shift_settlement_lines (id, tenant_id, settlement_id, payment_method, expected_minor, collected_minor, difference_minor, invoice_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, openShift.id, method, method === "cash" ? expectedCashMinor : collected[method], collected[method], counted[method] - (method === "cash" ? expectedCashMinor : collected[method]), method === "cash" ? Number(cashRows[0]?.count ?? 0) : (electronicRows.find((row) => row.method === method)?.count ?? 0), timestamp)),
    ]);
    if (!closed[0]?.meta || (closed[0].meta as D1Meta).changes !== 1) throw new ApiError("تم إقفال الوردية من مستخدم آخر", 409);
    const [closedRow] = await db.select().from(shiftSettlements).where(and(eq(shiftSettlements.id, openShift.id), eq(shiftSettlements.tenantId, tenantId))).limit(1);
    const lines = methods.map((method) => ({ paymentMethod: method, expectedMinor: method === "cash" ? expectedCashMinor : collected[method], collectedMinor: collected[method], countedMinor: counted[method], differenceMinor: counted[method] - (method === "cash" ? expectedCashMinor : collected[method]) }));
    const zReportSnapshot = await createZReportSnapshot({ db, tenantId, generatedBy: access.context.user.id, timezone: access.context.tenant.timezone, settlement: { ...openShift, ...(closedRow ?? {}), branchId, closedAt: closedRow?.closedAt ?? now, expectedCashMinor, countedCashMinor: counted.cash, cashDifferenceMinor: counted.cash - expectedCashMinor, electronicTotalMinor } });
    const zReport = { settlementId: openShift.id, branchId, openedAt: closedRow?.openedAt ?? openShift.openedAt, closedAt: closedRow?.closedAt ?? now, openingCashMinor: openShift.openingCashMinor, expectedCashMinor, countedCashMinor: counted.cash, cashDifferenceMinor: counted.cash - expectedCashMinor, electronicTotalMinor, collectedTotalMinor: methods.reduce((total, method) => total + collected[method], 0), lines };
    await writeAudit(access.context, request, "shift.closed", "shift_settlement", openShift.id, { expectedCashMinor, countedCashMinor: counted.cash, cashDifferenceMinor: counted.cash - expectedCashMinor, collected, counted });
    return Response.json({ settlement: closedRow, lines, zReport, zReportSnapshot: { id: zReportSnapshot.id, payloadHash: zReportSnapshot.payloadHash, createdAt: zReportSnapshot.createdAt, payload: zReportSnapshot.payload } });
  } catch (error) {
    if (String(error).includes("shift_one_open_branch_uq")) return Response.json({ error: "توجد وردية مفتوحة بالفعل لهذا الفرع" }, { status: 409 });
    return errorResponse(error);
  }
}

type D1Meta = { changes?: number };
