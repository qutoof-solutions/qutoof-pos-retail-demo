import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, count, eq, gte, inArray, lt, sum } from "drizzle-orm";
import { appointments, branches, invoices } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { localDateRangeToUtc } from "@/lib/time/timezone";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type CollectionRow = { paymentMethod: string; count: number; totalMinor: number };
type TreasuryRow = { direction: string; isOperatingExpense: number | boolean; count: number; totalMinor: number };
type ChequeSummaryRow = { status: string; count: number; totalMinor: number };
type SettlementSummary = { count: number; differenceMinor: number };

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const branchId = url.searchParams.get("branchId")?.trim() || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return Response.json({ error: serverMessage(request, "p1Server.reports.invalidPeriod") }, { status: 400 });
    const dateRange = localDateRangeToUtc(from, to, access.context.tenant.timezone);
    if (!dateRange) return Response.json({ error: serverMessage(request, "p1Server.reports.periodTooLong") }, { status: 400 });
    const { start, end } = dateRange;
    const appointmentFilters = [eq(appointments.tenantId, access.context.tenantId), gte(appointments.startsAt, start), lt(appointments.startsAt, end)];
    const invoiceFilters = [eq(invoices.tenantId, access.context.tenantId), gte(invoices.createdAt, start), lt(invoices.createdAt, end)];
    const accessibleBranchIds = await getAccessibleBranchIds(access.context);
    if (!accessibleBranchIds.length) return Response.json({ period: { from, to, timezone: access.context.tenant.timezone }, branches: [], appointments: [], invoices: [], money: { collections: [], treasury: [], customerCheques: [], supplierCheques: [], settlements: { count: 0, differenceMinor: 0 } } }, { headers: { "Cache-Control": "no-store" } });
    if (branchId) {
      if (!/^[0-9a-f-]{36}$/i.test(branchId)) return Response.json({ error: serverMessage(request, "p1Server.reports.invalidBranchId") }, { status: 400 });
      await requireBranchMembership(access.context, branchId);
      appointmentFilters.push(eq(appointments.branchId, branchId));
      invoiceFilters.push(eq(invoices.branchId, branchId));
    } else { appointmentFilters.push(inArray(appointments.branchId, accessibleBranchIds)); invoiceFilters.push(inArray(invoices.branchId, accessibleBranchIds)); }
    const [appointmentRows, invoiceRows, branchRows] = await Promise.all([
      access.context.db.select({ status: appointments.status, value: count() }).from(appointments).where(and(...appointmentFilters)).groupBy(appointments.status),
      access.context.db.select({ currency: invoices.currency, status: invoices.status, paymentMethod: invoices.paymentMethod, count: count(), totalMinor: sum(invoices.totalMinor), paidMinor: sum(invoices.paidMinor) }).from(invoices).where(and(...invoiceFilters)).groupBy(invoices.currency, invoices.status, invoices.paymentMethod),
      access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), inArray(branches.id, accessibleBranchIds))),
    ]);
    const scope = branchId ? [branchId] : accessibleBranchIds;
    const scopePlaceholders = scope.map(() => "?").join(",");
    const startMs = start.getTime();
    const endMs = end.getTime();
    const [collections, treasury, customerCheques, supplierCheques, settlementSummary] = await Promise.all([
      access.context.env.DB.prepare(`SELECT p.payment_method AS paymentMethod, COUNT(*) AS count, COALESCE(SUM(p.amount_minor), 0) AS totalMinor FROM invoice_payments p INNER JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at < ? AND p.reversed_at IS NULL AND i.status <> 'void' AND i.branch_id IN (${scopePlaceholders}) GROUP BY p.payment_method`).bind(access.context.tenantId, startMs, endMs, ...scope).all<CollectionRow>(),
      access.context.env.DB.prepare(`SELECT direction, is_operating_expense AS isOperatingExpense, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS totalMinor FROM treasury_transactions WHERE tenant_id = ? AND created_at >= ? AND created_at < ? AND branch_id IN (${scopePlaceholders}) GROUP BY direction, is_operating_expense`).bind(access.context.tenantId, startMs, endMs, ...scope).all<TreasuryRow>(),
      access.context.env.DB.prepare(`SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS totalMinor FROM customer_cheques WHERE tenant_id = ? AND created_at >= ? AND created_at < ? AND branch_id IN (${scopePlaceholders}) GROUP BY status`).bind(access.context.tenantId, startMs, endMs, ...scope).all<ChequeSummaryRow>(),
      access.context.env.DB.prepare(`SELECT c.status, COUNT(*) AS count, COALESCE(SUM(c.amount_minor), 0) AS totalMinor FROM supplier_cheques c INNER JOIN purchase_invoices p ON p.id = c.purchase_invoice_id AND p.tenant_id = c.tenant_id INNER JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.created_at >= ? AND c.created_at < ? AND w.branch_id IN (${scopePlaceholders}) GROUP BY c.status`).bind(access.context.tenantId, startMs, endMs, ...scope).all<ChequeSummaryRow>(),
      access.context.env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(cash_difference_minor), 0) AS differenceMinor FROM shift_settlements WHERE tenant_id = ? AND status = 'closed' AND CASE WHEN closed_at < 1000000000000 THEN closed_at * 1000 ELSE closed_at END >= ? AND CASE WHEN closed_at < 1000000000000 THEN closed_at * 1000 ELSE closed_at END < ? AND branch_id IN (${scopePlaceholders})`).bind(access.context.tenantId, startMs, endMs, ...scope).first<SettlementSummary>(),
    ]);
    return Response.json({
      period: { from, to, timezone: access.context.tenant.timezone },
      branches: branchRows,
      appointments: appointmentRows.map((row) => ({ status: row.status, count: Number(row.value) || 0 })),
      invoices: invoiceRows.map((row) => ({ currency: row.currency, status: row.status, paymentMethod: row.paymentMethod, count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0, paidMinor: Number(row.paidMinor) || 0 })),
      money: {
        collections: collections.results.map((row) => ({ paymentMethod: row.paymentMethod, count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0 })),
        treasury: treasury.results.map((row) => ({ direction: row.direction, isOperatingExpense: Boolean(row.isOperatingExpense), count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0 })),
        customerCheques: customerCheques.results.map((row) => ({ status: row.status, count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0 })),
        supplierCheques: supplierCheques.results.map((row) => ({ status: row.status, count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0 })),
        settlements: { count: Number(settlementSummary?.count ?? 0), differenceMinor: Number(settlementSummary?.differenceMinor ?? 0) },
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, serverMessage(request, "p1Server.reports.createFailed"));
  }
}
