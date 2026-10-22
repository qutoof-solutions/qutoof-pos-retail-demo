import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { branches, queueTickets, tenants } from "@/lib/db/schema";
import { deriveTenantBillingStatus, operationalAccessAllowed } from "@/lib/platform/billing";
import { isFeatureEnabled, isPlanFeatureEnabled } from "@/lib/platform/features";

export const runtime = "edge";
type RouteContext = { params: Promise<{ branchId: string }> };

export async function GET(_request: Request, route: RouteContext): Promise<Response> {
  const { branchId } = await route.params;
  if (!z.string().uuid().safeParse(branchId).success) return Response.json({ error: "معرف الفرع غير صالح" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const db = getDb();
  const [branch] = await db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn, tenantId: branches.tenantId, tenantName: tenants.name, tenantStatus: tenants.status, trialEndsAt: tenants.trialEndsAt, subscriptionEndsAt: tenants.subscriptionEndsAt, platformPlanId: tenants.platformPlanId }).from(branches).innerJoin(tenants, eq(tenants.id, branches.tenantId)).where(and(eq(branches.id, branchId), eq(branches.isActive, true))).limit(1);
  if (!branch) return Response.json({ error: "الفرع غير موجود" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const allowed = operationalAccessAllowed(deriveTenantBillingStatus({ status: branch.tenantStatus, trialEndsAt: branch.trialEndsAt, subscriptionEndsAt: branch.subscriptionEndsAt }));
  const [queueEntitled, maintenanceMode] = await Promise.all([isPlanFeatureEnabled(db, branch.platformPlanId, "queue"), isFeatureEnabled(db, "maintenance_mode", false)]);
  if (!allowed || !queueEntitled || maintenanceMode) return Response.json({ error: "لوحة الانتظار غير متاحة" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const active = await db.select({ ticketNumber: queueTickets.ticketNumber, displayLabel: queueTickets.displayLabel, status: queueTickets.status, issuedAt: queueTickets.issuedAt, calledAt: queueTickets.calledAt }).from(queueTickets).where(and(eq(queueTickets.tenantId, branch.tenantId), eq(queueTickets.branchId, branchId), inArray(queueTickets.status, ["waiting", "called", "serving"]))).orderBy(asc(queueTickets.issuedAt));
  const current = active.find((ticket) => ticket.status === "serving") ?? active.find((ticket) => ticket.status === "called") ?? null;
  const next = active.find((ticket) => ticket.status === "waiting") ?? null;
  return Response.json({ branch: { id: branch.id, name: branch.name, nameAr: branch.nameAr, nameEn: branch.nameEn, tenantName: branch.tenantName }, current: current ? { ticketNumber: current.ticketNumber, displayLabel: current.displayLabel, status: current.status, calledAt: current.calledAt } : null, next: next ? { ticketNumber: next.ticketNumber, displayLabel: next.displayLabel } : null, waitingCount: active.filter((ticket) => ticket.status === "waiting").length, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store, max-age=0", "Access-Control-Allow-Origin": "*" } });
}
