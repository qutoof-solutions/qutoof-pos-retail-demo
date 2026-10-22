import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { distributionRoutes, distributionTrips, salesReps, treasuryAccounts, treasuryTransactions } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const accountSchema = z.object({ action: z.literal("create_account"), branchId: uuidSchema.nullable().optional(), accountType: z.enum(["cash", "bank"]), name: z.string().trim().min(2).max(100), bankName: z.string().trim().max(100).nullable().optional(), accountReference: z.string().trim().max(80).nullable().optional(), openingBalance: moneySchema.max(100_000_000).default(0) });
const entrySchema = z.object({ action: z.literal("record"), accountId: uuidSchema, entryType: z.enum(["receipt", "expense", "disbursement"]), category: z.enum(["customer_receipt", "other_receipt", "transport", "fuel", "loading", "rent", "salary", "petty_cash", "supplier", "owner_draw", "other"]), amount: moneySchema.min(0.01).max(100_000_000), branchId: uuidSchema.nullable().optional(), routeId: uuidSchema.nullable().optional(), salesRepId: uuidSchema.nullable().optional(), tripId: uuidSchema.nullable().optional(), description: z.string().trim().min(2).max(240), reference: z.string().trim().max(120).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(120) });
const reverseSchema = z.object({ action: z.literal("reverse"), transactionId: uuidSchema, reason: z.string().trim().min(3).max(240) });
const postSchema = z.discriminatedUnion("action", [accountSchema, entrySchema, reverseSchema]);

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  try {
    if (branchId) await requireBranchMembership(access.context, branchId);
    else await requireAllActiveBranchMemberships(access.context);
    const filters = [eq(treasuryAccounts.tenantId, access.context.tenantId)];
    if (branchId) filters.push(or(eq(treasuryAccounts.branchId, branchId), isNull(treasuryAccounts.branchId))!);
    const accounts = await access.context.db.select().from(treasuryAccounts).where(and(...filters)).orderBy(treasuryAccounts.name);
    const accountIds = accounts.map((account) => account.id);
    const transactionFilters = [eq(treasuryTransactions.tenantId, access.context.tenantId), inArray(treasuryTransactions.accountId, accountIds)];
    if (branchId) transactionFilters.push(or(eq(treasuryTransactions.branchId, branchId), isNull(treasuryTransactions.branchId))!);
    const transactions = accountIds.length ? await access.context.db.select().from(treasuryTransactions).where(and(...transactionFilters)).orderBy(desc(treasuryTransactions.createdAt)).limit(100) : [];
    const balances = accountIds.length ? await access.context.env.DB.prepare(`SELECT account_id AS accountId, SUM(CASE WHEN direction = 'in' THEN amount_minor ELSE -amount_minor END) AS movementMinor FROM treasury_transactions WHERE tenant_id = ? AND account_id IN (${accountIds.map(() => "?").join(",")}) GROUP BY account_id`).bind(access.context.tenantId, ...accountIds).all<{ accountId: string; movementMinor: number }>() : { results: [] as Array<{ accountId: string; movementMinor: number }> };
    const movementMap = new Map(balances.results.map((row) => [row.accountId, row.movementMinor]));
    return Response.json({ accounts: accounts.map((account) => ({ ...account, balanceMinor: account.openingBalanceMinor + (movementMap.get(account.id) ?? 0) })), transactions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر تحميل الخزنة والحسابات"); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات الخزنة أو السند");
    const input = parsed.data;
    const now = new Date();
    if (input.action === "create_account") {
      if (input.branchId) await requireBranchMembership(access.context, input.branchId);
      else await requireAllActiveBranchMemberships(access.context);
      const account = { id: crypto.randomUUID(), tenantId: access.context.tenantId, branchId: input.branchId ?? null, accountType: input.accountType, name: input.name, bankName: input.bankName?.trim() || null, accountReference: input.accountReference?.trim() || null, currency: "EGP", openingBalanceMinor: Math.round(input.openingBalance * 100), isActive: true, createdBy: access.context.user.id, createdAt: now, updatedAt: now };
      await access.context.db.insert(treasuryAccounts).values(account).run();
      await writeAudit(access.context, request, "treasury.account.created", "treasury_account", account.id, { accountType: account.accountType, branchId: account.branchId });
      return Response.json({ account: { ...account, balanceMinor: account.openingBalanceMinor } }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "reverse") {
      const [original] = await access.context.db.select().from(treasuryTransactions).where(and(eq(treasuryTransactions.id, input.transactionId), eq(treasuryTransactions.tenantId, access.context.tenantId))).limit(1);
      if (!original) throw new ApiError("السند غير موجود", 404);
      if (original.reversalOfId) throw new ApiError("لا يمكن عكس سند عكسي؛ اعكس السند الأصلي فقط", 409);
      const [existing] = await access.context.db.select({ id: treasuryTransactions.id }).from(treasuryTransactions).where(and(eq(treasuryTransactions.tenantId, access.context.tenantId), eq(treasuryTransactions.reversalOfId, original.id))).limit(1);
      if (existing) throw new ApiError("سبق عكس هذا السند", 409);
      if (original.branchId) await requireBranchMembership(access.context, original.branchId);
      else await requireAllActiveBranchMemberships(access.context);
      const reversal = { id: crypto.randomUUID(), tenantId: access.context.tenantId, accountId: original.accountId, branchId: original.branchId, routeId: original.routeId, salesRepId: original.salesRepId, tripId: original.tripId, direction: original.direction === "in" ? "out" as const : "in" as const, category: original.category, isOperatingExpense: original.isOperatingExpense, amountMinor: original.amountMinor, currency: original.currency, description: `عكس سند: ${input.reason}`, reference: original.reference, idempotencyKey: `reversal:${original.id}`, reversalOfId: original.id, createdBy: access.context.user.id, createdAt: now };
      await access.context.db.insert(treasuryTransactions).values(reversal).run();
      await writeAudit(access.context, request, "treasury.transaction.reversed", "treasury_transaction", original.id, { reversalId: reversal.id, reason: input.reason });
      return Response.json({ reversal }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const branchId = input.branchId ?? null;
    if (branchId) await requireBranchMembership(access.context, branchId);
    const [account] = await access.context.db.select().from(treasuryAccounts).where(and(eq(treasuryAccounts.id, input.accountId), eq(treasuryAccounts.tenantId, access.context.tenantId), eq(treasuryAccounts.isActive, true))).limit(1);
    if (!account) throw new ApiError("حساب الخزنة غير موجود أو غير نشط", 404);
    const effectiveBranch = branchId ?? account.branchId;
    if (account.branchId && effectiveBranch !== account.branchId) throw new ApiError("حساب الخزنة لا يتبع الفرع المحدد", 409);
    if (effectiveBranch) await requireBranchMembership(access.context, effectiveBranch);
    else await requireAllActiveBranchMemberships(access.context);
    let direction: "in" | "out";
    let isOperatingExpense = false;
    if (input.entryType === "receipt") {
      if (!["customer_receipt", "other_receipt"].includes(input.category)) throw new ApiError("فئة سند القبض غير صحيحة");
      direction = "in";
    } else if (input.entryType === "expense") {
      if (!["transport", "fuel", "loading", "rent", "salary", "petty_cash", "other"].includes(input.category)) throw new ApiError("اختر بند مصروف تشغيلي صالحًا");
      direction = "out"; isOperatingExpense = true;
    } else {
      if (!["supplier", "owner_draw", "other"].includes(input.category)) throw new ApiError("فئة سند الصرف غير صحيحة");
      direction = "out";
    }
    let routeId = input.routeId ?? null;
    let salesRepId = input.salesRepId ?? null;
    let tripId = input.tripId ?? null;
    if (routeId) {
      const [route] = await access.context.db.select({ id: distributionRoutes.id, branchId: distributionRoutes.branchId }).from(distributionRoutes).where(and(eq(distributionRoutes.id, routeId), eq(distributionRoutes.tenantId, access.context.tenantId), eq(distributionRoutes.isActive, true))).limit(1);
      if (!route || (effectiveBranch && effectiveBranch !== route.branchId)) throw new ApiError("خط السير غير صالح لهذا الفرع", 409);
      routeId = route.id;
    }
    if (salesRepId) {
      const [rep] = await access.context.db.select({ id: salesReps.id, branchId: salesReps.branchId, routeId: salesReps.routeId }).from(salesReps).where(and(eq(salesReps.id, salesRepId), eq(salesReps.tenantId, access.context.tenantId), eq(salesReps.isActive, true))).limit(1);
      if (!rep || (effectiveBranch && rep.branchId !== effectiveBranch) || (routeId && rep.routeId && rep.routeId !== routeId)) throw new ApiError("المندوب غير صالح لهذا الفرع أو خط السير", 409);
      if (!routeId) routeId = rep.routeId;
      salesRepId = rep.id;
    }
    if (tripId) {
      const [trip] = await access.context.db.select({ id: distributionTrips.id, routeId: distributionTrips.routeId, salesRepId: distributionTrips.salesRepId, branchId: distributionTrips.branchId }).from(distributionTrips).where(and(eq(distributionTrips.id, tripId), eq(distributionTrips.tenantId, access.context.tenantId))).limit(1);
      if (!trip || (effectiveBranch && trip.branchId !== effectiveBranch) || (routeId && routeId !== trip.routeId) || (salesRepId && salesRepId !== trip.salesRepId)) throw new ApiError("الرحلة لا تتطابق مع الفرع أو المندوب أو خط السير", 409);
      routeId = trip.routeId; salesRepId = trip.salesRepId; tripId = trip.id;
    }
    const existing = await access.context.db.select().from(treasuryTransactions).where(and(eq(treasuryTransactions.tenantId, access.context.tenantId), eq(treasuryTransactions.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing[0]) return Response.json({ transaction: existing[0], replayed: true }, { headers: { "Cache-Control": "no-store" } });
    const transaction = { id: crypto.randomUUID(), tenantId: access.context.tenantId, accountId: account.id, branchId: effectiveBranch, routeId, salesRepId, tripId, direction, category: input.category, isOperatingExpense, amountMinor: Math.round(input.amount * 100), currency: account.currency, description: input.description, reference: input.reference?.trim() || null, idempotencyKey: input.idempotencyKey, reversalOfId: null, createdBy: access.context.user.id, createdAt: now };
    await access.context.db.insert(treasuryTransactions).values(transaction).run();
    await writeAudit(access.context, request, "treasury.transaction.created", "treasury_transaction", transaction.id, { direction, category: transaction.category, amountMinor: transaction.amountMinor, accountId: account.id, routeId, salesRepId, tripId });
    return Response.json({ transaction }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("TREASURY_INSUFFICIENT_FUNDS")) return Response.json({ error: "رصيد الخزنة غير كافٍ لإتمام سند الصرف" }, { status: 409 });
    if (String(error).includes("treasury_transactions_tenant_idempotency_uq")) return Response.json({ error: "مفتاح السند مستخدم مسبقًا؛ حدّث السجل قبل إعادة المحاولة" }, { status: 409 });
    if (String(error).includes("treasury_transactions_reversal_uq")) return Response.json({ error: "سبق عكس هذا السند" }, { status: 409 });
    if (String(error).includes("treasury_accounts_tenant_branch_name_uq")) return Response.json({ error: "اسم الحساب مستخدم بالفعل في هذا الفرع" }, { status: 409 });
    return errorResponse(error, "تعذر تسجيل حركة الخزنة");
  }
}
