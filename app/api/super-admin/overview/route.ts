import { count, eq, sum } from "drizzle-orm";
import { appointments, platformBillingRequests, platformInvoices, tenants } from "@/lib/db/schema";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const { db } = access.context;
  const [total, byStatus, revenue, bookings, pending] = await Promise.all([
    db.select({ value: count() }).from(tenants),
    db.select({ status: tenants.status, value: count() }).from(tenants).groupBy(tenants.status),
    db.select({ amountMinor: sum(platformInvoices.amountMinor) }).from(platformInvoices).where(eq(platformInvoices.status, "paid")),
    db.select({ value: count() }).from(appointments),
    db.select({ value: count() }).from(platformBillingRequests).where(eq(platformBillingRequests.status, "pending_review")),
  ]);
  const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row.value]));
  return Response.json({ totalTenants: total[0]?.value ?? 0, statuses: statusCounts, revenueMinor: Number(revenue[0]?.amountMinor ?? 0), bookings: bookings[0]?.value ?? 0, pendingBillingRequests: pending[0]?.value ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
