import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { customers, loyaltyAccounts, loyaltyTransactions } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { uuidSchema } from "@/lib/operations/validation";
import { discountMinorForPoints, pointsEarnedForPurchase } from "@/lib/operations/loyalty";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("earn"), totalMinor: z.number().int().nonnegative().max(1_000_000_000), invoiceId: uuidSchema.nullable().optional() }),
  z.object({ action: z.literal("redeem"), points: z.number().int().positive().max(1_000_000), invoiceId: uuidSchema.nullable().optional() }),
]);

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("معرف العميل غير صالح");
    const [customer] = await access.context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, access.context.tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    const [account] = await access.context.db.select().from(loyaltyAccounts).where(and(eq(loyaltyAccounts.tenantId, access.context.tenantId), eq(loyaltyAccounts.customerId, id))).limit(1);
    const transactions = account ? await access.context.db.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.tenantId, access.context.tenantId), eq(loyaltyTransactions.accountId, account.id))).orderBy(desc(loyaltyTransactions.createdAt)).limit(50) : [];
    return Response.json({ account: account ?? { pointsBalance: 0, lifetimePoints: 0 }, transactions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات حركة الولاء غير صالحة");
    const [customer] = await access.context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, access.context.tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    const points = parsed.data.action === "earn" ? pointsEarnedForPurchase(parsed.data.totalMinor) : -parsed.data.points;
    const now = new Date();
    const [account] = await access.context.db.insert(loyaltyAccounts).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, customerId: id, pointsBalance: 0, lifetimePoints: 0, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
    const current = account ?? (await access.context.db.select().from(loyaltyAccounts).where(and(eq(loyaltyAccounts.tenantId, access.context.tenantId), eq(loyaltyAccounts.customerId, id))).limit(1))[0];
    if (!current) throw new ApiError("تعذر إنشاء حساب الولاء", 500);
    if (points < 0 && current.pointsBalance < Math.abs(points)) throw new ApiError("رصيد نقاط الولاء غير كافٍ", 409);
    const [updated] = await access.context.db.update(loyaltyAccounts).set({ pointsBalance: current.pointsBalance + points, lifetimePoints: current.lifetimePoints + Math.max(points, 0), updatedAt: now }).where(and(eq(loyaltyAccounts.id, current.id), eq(loyaltyAccounts.tenantId, access.context.tenantId))).returning();
    const [transaction] = await access.context.db.insert(loyaltyTransactions).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, accountId: current.id, invoiceId: parsed.data.invoiceId ?? null, pointsDelta: points, reason: parsed.data.action === "earn" ? "purchase" : `redeem:${discountMinorForPoints(Math.abs(points))}`, createdBy: access.context.user.id, createdAt: now }).returning();
    await writeAudit(access.context, request, `loyalty.${parsed.data.action}`, "loyalty_account", current.id, { points });
    return Response.json({ account: updated, transaction }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
