import { and, countDistinct, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { invoiceItems, invoices, users } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { localTimeToUtc } from "@/lib/time/timezone";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";

export const runtime = "edge";
function shiftMonth(value: string, amount: number): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function nextDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const url = new URL(request.url);
  const period = url.searchParams.get("period") === "monthly" ? "monthly" : "daily";
  const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: access.context.tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (key: string) => todayParts.find((value) => value.type === key)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const supplied = url.searchParams.get("date") ?? today;
  const valid = period === "monthly" ? /^\d{4}-\d{2}$/.test(supplied) : /^\d{4}-\d{2}-\d{2}$/.test(supplied);
  if (!valid) return Response.json({ error: "التاريخ غير صالح" }, { status: 400 });
  const firstDay = period === "monthly" ? `${supplied}-01` : supplied;
  const lastDay = period === "monthly" ? shiftMonth(firstDay, 1) : nextDay(firstDay);
  const start = localTimeToUtc(firstDay, "00:00", access.context.tenant.timezone);
  const end = localTimeToUtc(lastDay, "00:00", access.context.tenant.timezone);
  if (!start || !end) return Response.json({ error: "تعذر حساب حدود الفترة في المنطقة الزمنية للنشاط" }, { status: 400 });
  try {
    const branchIds = await getAccessibleBranchIds(access.context);
    if (!branchIds.length) return Response.json({ period, range: { from: "", to: "", timezone: access.context.tenant.timezone, currency: "EGP" }, totals: { commissionMinor: 0, grossMinor: 0 }, providers: [] }, { headers: { "Cache-Control": "no-store" } });
    const commissionMinor = sql<number>`CAST(ROUND(SUM(CASE WHEN ${invoiceItems.commissionMode} = 'fixed' THEN ${invoiceItems.commissionFixedMinor} * ${invoiceItems.quantity} ELSE ((${invoiceItems.lineTotalMinor} - CASE WHEN ${invoices.subtotalMinor} > 0 THEN (1.0 * ${invoices.discountMinor} * ${invoiceItems.lineTotalMinor} / ${invoices.subtotalMinor}) ELSE 0 END) * ${invoiceItems.commissionBps}) / 10000.0 END)) AS INTEGER)`;
    const rows = await access.context.db.select({ providerId: invoiceItems.providerId, providerName: users.fullName, commissionMinor, grossMinor: sql<number>`CAST(ROUND(SUM(${invoiceItems.lineTotalMinor} - CASE WHEN ${invoices.subtotalMinor} > 0 THEN (1.0 * ${invoices.discountMinor} * ${invoiceItems.lineTotalMinor} / ${invoices.subtotalMinor}) ELSE 0 END)) AS INTEGER)`, lineCount: sql<number>`COUNT(*)`, invoiceCount: countDistinct(invoiceItems.invoiceId) }).from(invoiceItems)
      .innerJoin(invoices, and(eq(invoices.id, invoiceItems.invoiceId), eq(invoices.tenantId, access.context.tenantId)))
      .leftJoin(users, and(eq(users.id, invoiceItems.providerId), eq(users.tenantId, access.context.tenantId)))
      .where(and(eq(invoiceItems.tenantId, access.context.tenantId), eq(invoices.status, "paid"), inArray(invoices.branchId, branchIds), gte(invoices.paidAt, start), lt(invoices.paidAt, end)))
      .groupBy(invoiceItems.providerId, users.fullName).orderBy(sql`2 DESC`);
    const totals = rows.reduce((sum, row) => ({ commissionMinor: sum.commissionMinor + (row.commissionMinor ?? 0), grossMinor: sum.grossMinor + (row.grossMinor ?? 0) }), { commissionMinor: 0, grossMinor: 0 });
    return Response.json({ period, range: { from: firstDay, to: lastDay, timezone: access.context.tenant.timezone, currency: "EGP" }, totals, providers: rows.map((row) => ({ providerId: row.providerId, providerName: row.providerName ?? "مقدم خدمة غير محدد", commissionMinor: row.commissionMinor ?? 0, grossMinor: row.grossMinor ?? 0, invoiceCount: row.invoiceCount, lineCount: row.lineCount })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
