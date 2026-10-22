import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { distributionRoutes, distributionTripInvoices, distributionTripLines, distributionTrips, inventoryItems, invoicePayments, invoices, salesReps, stockMovements, treasuryTransactions } from "@/lib/db/schema";
import { calculateProfit } from "@/lib/operations/distribution-finance";
import { errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";
import { localDateRangeToUtc, safeLocalDateKey } from "@/lib/time/timezone";

export const runtime = "edge";
const dateSchema = z.string().date();
type Bucket = { id: string; name: string; salesMinor: number; cogsMinor: number; operatingExpensesMinor: number; commissionMinor: number };
const factorByScale = (scale: number) => 10 ** scale;

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const today = safeLocalDateKey(new Date(), access.context.tenant.timezone);
    if (!today) return Response.json({ error: serverMessage(request, "p1Server.financial.invalidDateRange") }, { status: 400 });
    const from = fromRaw ?? `${today.slice(0, 8)}01`;
    const to = toRaw ?? today;
    if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to) return Response.json({ error: serverMessage(request, "p1Server.financial.invalidDateRange") }, { status: 400 });
    if (branchId) await requireBranchMembership(access.context, branchId);
    else await requireAllActiveBranchMemberships(access.context);
    const accessibleBranchIds = await getAccessibleBranchIds(access.context);
    if (!accessibleBranchIds.length) return Response.json({ period: { from, to, timezone: access.context.tenant.timezone, branchId: branchId ?? null }, totals: { salesMinor: 0, cogsMinor: 0, writeOffMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0, grossProfitMinor: 0, netProfitMinor: 0, collectedMinor: 0, invoiceCount: 0 }, byRep: [], byRoute: [], accountingBasis: serverMessage(request, "p1Server.financial.accountingBasis") }, { headers: { "Cache-Control": "no-store" } });
    const dateRange = localDateRangeToUtc(from, to, access.context.tenant.timezone);
    if (!dateRange) return Response.json({ error: serverMessage(request, "p1Server.financial.invalidDateRange") }, { status: 400 });
    const { start, end } = dateRange;
    const invoiceFilters = [eq(invoices.tenantId, access.context.tenantId), ne(invoices.status, "void"), gte(invoices.createdAt, start), lt(invoices.createdAt, end)];
    if (branchId) invoiceFilters.push(eq(invoices.branchId, branchId)); else invoiceFilters.push(inArray(invoices.branchId, accessibleBranchIds));
    const invoiceRows = await access.context.db.select({ invoiceId: invoices.id, branchId: invoices.branchId, totalMinor: invoices.totalMinor, tripId: distributionTripInvoices.tripId, salesRepId: distributionTrips.salesRepId, routeId: distributionTrips.routeId, repName: salesReps.fullName, routeName: distributionRoutes.name, commissionBps: salesReps.commissionBps }).from(invoices).leftJoin(distributionTripInvoices, and(eq(distributionTripInvoices.invoiceId, invoices.id), eq(distributionTripInvoices.tenantId, access.context.tenantId))).leftJoin(distributionTrips, and(eq(distributionTrips.id, distributionTripInvoices.tripId), eq(distributionTrips.tenantId, access.context.tenantId))).leftJoin(salesReps, and(eq(salesReps.id, distributionTrips.salesRepId), eq(salesReps.tenantId, access.context.tenantId))).leftJoin(distributionRoutes, and(eq(distributionRoutes.id, distributionTrips.routeId), eq(distributionRoutes.tenantId, access.context.tenantId))).where(and(...invoiceFilters));
    const invoiceIds = invoiceRows.map((row) => row.invoiceId);
    const costRows = invoiceIds.length ? await access.context.db.select({ invoiceId: stockMovements.referenceId, quantityDelta: stockMovements.quantityDelta, unitCostMinor: stockMovements.unitCostMinor, quantityScale: inventoryItems.quantityScale }).from(stockMovements).innerJoin(inventoryItems, and(eq(inventoryItems.id, stockMovements.itemId), eq(inventoryItems.tenantId, access.context.tenantId))).where(and(eq(stockMovements.tenantId, access.context.tenantId), eq(stockMovements.referenceType, "invoice"), eq(stockMovements.movementType, "pos_deduction"), inArray(stockMovements.referenceId, invoiceIds))) : [];
    const cogsByInvoice = new Map<string, number>();
    for (const row of costRows) if (row.invoiceId && row.quantityDelta < 0) cogsByInvoice.set(row.invoiceId, (cogsByInvoice.get(row.invoiceId) ?? 0) + Math.round((-row.quantityDelta * (row.unitCostMinor ?? 0)) / factorByScale(row.quantityScale)));
    const tripFilters = [eq(distributionTrips.tenantId, access.context.tenantId), eq(distributionTrips.status, "settled"), gte(distributionTrips.closedAt, start), lt(distributionTrips.closedAt, end)];
    if (branchId) tripFilters.push(eq(distributionTrips.branchId, branchId)); else tripFilters.push(inArray(distributionTrips.branchId, accessibleBranchIds));
    const writeOffRows = await access.context.db.select({ tripId: distributionTripLines.tripId, itemId: distributionTripLines.itemId, salesRepId: distributionTrips.salesRepId, routeId: distributionTrips.routeId, repName: salesReps.fullName, routeName: distributionRoutes.name, quantityScale: distributionTripLines.quantityScale, unitCostMinor: distributionTripLines.unitCostMinor, damaged: distributionTripLines.returnedDamagedUnits, missing: distributionTripLines.missingUnits }).from(distributionTripLines).innerJoin(distributionTrips, and(eq(distributionTrips.id, distributionTripLines.tripId), eq(distributionTrips.tenantId, access.context.tenantId))).innerJoin(salesReps, and(eq(salesReps.id, distributionTrips.salesRepId), eq(salesReps.tenantId, access.context.tenantId))).innerJoin(distributionRoutes, and(eq(distributionRoutes.id, distributionTrips.routeId), eq(distributionRoutes.tenantId, access.context.tenantId))).where(and(...tripFilters));
    const expenseFilters = [eq(treasuryTransactions.tenantId, access.context.tenantId), eq(treasuryTransactions.isOperatingExpense, true), gte(treasuryTransactions.createdAt, start), lt(treasuryTransactions.createdAt, end)];
    if (branchId) expenseFilters.push(eq(treasuryTransactions.branchId, branchId)); else expenseFilters.push(inArray(treasuryTransactions.branchId, accessibleBranchIds));
    const expenses = await access.context.db.select({ branchId: treasuryTransactions.branchId, routeId: treasuryTransactions.routeId, salesRepId: treasuryTransactions.salesRepId, direction: treasuryTransactions.direction, amountMinor: treasuryTransactions.amountMinor }).from(treasuryTransactions).where(and(...expenseFilters));
    const repBpsRows = await access.context.db.select({ id: salesReps.id, commissionBps: salesReps.commissionBps, name: salesReps.fullName }).from(salesReps).where(eq(salesReps.tenantId, access.context.tenantId));
    const repBps = new Map(repBpsRows.map((row) => [row.id, row.commissionBps]));
    const repNames = new Map(repBpsRows.map((row) => [row.id, row.name]));
    const routeRows = await access.context.db.select({ id: distributionRoutes.id, name: distributionRoutes.name }).from(distributionRoutes).where(eq(distributionRoutes.tenantId, access.context.tenantId));
    const routeNames = new Map(routeRows.map((row) => [row.id, row.name]));
    const repBuckets = new Map<string, Bucket>();
    const routeBuckets = new Map<string, Bucket>();
    let salesMinor = 0;
    let cogsMinor = 0;
    let commissionMinor = 0;
    for (const invoice of invoiceRows) {
      const cost = cogsByInvoice.get(invoice.invoiceId) ?? 0;
      salesMinor += invoice.totalMinor;
      cogsMinor += cost;
      if (invoice.salesRepId && invoice.routeId) {
        const bps = repBps.get(invoice.salesRepId) ?? invoice.commissionBps ?? 0;
        const commission = Math.round(invoice.totalMinor * bps / 10_000);
        commissionMinor += commission;
        const rep = repBuckets.get(invoice.salesRepId) ?? { id: invoice.salesRepId, name: invoice.repName ?? serverMessage(request, "p1Server.financial.representative"), salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
        rep.salesMinor += invoice.totalMinor; rep.cogsMinor += cost; rep.commissionMinor += commission; repBuckets.set(invoice.salesRepId, rep);
        const route = routeBuckets.get(invoice.routeId) ?? { id: invoice.routeId, name: invoice.routeName ?? serverMessage(request, "p1Server.financial.route"), salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
        route.salesMinor += invoice.totalMinor; route.cogsMinor += cost; route.commissionMinor += commission; routeBuckets.set(invoice.routeId, route);
      }
    }
    let writeOffMinor = 0;
    for (const row of writeOffRows) {
      const loss = Math.round((row.damaged + row.missing) * row.unitCostMinor / factorByScale(row.quantityScale));
      writeOffMinor += loss; cogsMinor += loss;
      const rep = repBuckets.get(row.salesRepId) ?? { id: row.salesRepId, name: row.repName, salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
      rep.cogsMinor += loss; repBuckets.set(row.salesRepId, rep);
      const route = routeBuckets.get(row.routeId) ?? { id: row.routeId, name: row.routeName, salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
      route.cogsMinor += loss; routeBuckets.set(row.routeId, route);
    }
    let operatingExpensesMinor = 0;
    for (const expense of expenses) {
      const signed = expense.direction === "out" ? expense.amountMinor : -expense.amountMinor;
      operatingExpensesMinor += signed;
      if (expense.salesRepId) {
        const rep = repBuckets.get(expense.salesRepId) ?? { id: expense.salesRepId, name: repNames.get(expense.salesRepId) ?? serverMessage(request, "p1Server.financial.representative"), salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
        rep.operatingExpensesMinor += signed; repBuckets.set(expense.salesRepId, rep);
      }
      if (expense.routeId) {
        const route = routeBuckets.get(expense.routeId) ?? { id: expense.routeId, name: routeNames.get(expense.routeId) ?? serverMessage(request, "p1Server.financial.route"), salesMinor: 0, cogsMinor: 0, operatingExpensesMinor: 0, commissionMinor: 0 };
        route.operatingExpensesMinor += signed; routeBuckets.set(expense.routeId, route);
      }
    }
    const totals = calculateProfit({ salesMinor, cogsMinor, operatingExpensesMinor, commissionBps: 0 });
    const repProfit = [...repBuckets.values()].map((bucket) => ({ ...bucket, grossProfitMinor: bucket.salesMinor - bucket.cogsMinor, netProfitMinor: bucket.salesMinor - bucket.cogsMinor - bucket.operatingExpensesMinor - bucket.commissionMinor })).sort((a, b) => b.netProfitMinor - a.netProfitMinor);
    const routeProfit = [...routeBuckets.values()].map((bucket) => ({ ...bucket, grossProfitMinor: bucket.salesMinor - bucket.cogsMinor, netProfitMinor: bucket.salesMinor - bucket.cogsMinor - bucket.operatingExpensesMinor - bucket.commissionMinor })).sort((a, b) => b.netProfitMinor - a.netProfitMinor);
    const paymentFilters = [eq(invoicePayments.tenantId, access.context.tenantId), gte(invoicePayments.createdAt, start), lt(invoicePayments.createdAt, end), isNull(invoicePayments.reversedAt), ne(invoices.status, "void")];
    if (branchId) paymentFilters.push(eq(invoices.branchId, branchId)); else paymentFilters.push(inArray(invoices.branchId, accessibleBranchIds));
    const paymentRows = await access.context.db.select({ amountMinor: invoicePayments.amountMinor }).from(invoicePayments).innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, access.context.tenantId))).where(and(...paymentFilters));
    const collectedMinor = paymentRows.reduce((sum, row) => sum + row.amountMinor, 0);
    return Response.json({ period: { from, to, timezone: access.context.tenant.timezone, branchId: branchId ?? null }, totals: { salesMinor: totals.salesMinor, cogsMinor: totals.cogsMinor, writeOffMinor, operatingExpensesMinor: totals.operatingExpensesMinor, commissionMinor, grossProfitMinor: salesMinor - cogsMinor, netProfitMinor: totals.netProfitMinor - commissionMinor, collectedMinor, invoiceCount: invoiceRows.length }, byRep: repProfit, byRoute: routeProfit, accountingBasis: serverMessage(request, "p1Server.financial.accountingBasis") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, serverMessage(request, "p1Server.financial.reportFailed")); }
}
