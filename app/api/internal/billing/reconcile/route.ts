import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { deriveTenantBillingStatus } from "@/lib/platform/billing";
import { platformSettings, tenants } from "@/lib/db/schema";
import { safeEqual } from "@/lib/whatsapp/security";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  if (!env.BILLING_CRON_SECRET || env.BILLING_CRON_SECRET.length < 32) return Response.json({ error: "Billing reconciler is not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), env.BILLING_CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [graceSetting] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, "grace_days")).limit(1);
  const graceDays = Number.isInteger(Number(graceSetting?.value)) && Number(graceSetting?.value) >= 0 && Number(graceSetting?.value) <= 30 ? Number(graceSetting?.value) : 3;
  const now = new Date();
  let cursor = "";
  let scanned = 0;
  let updated = 0;
  for (let page = 0; page < 100; page += 1) {
    const rows = await db.select({ id: tenants.id, status: tenants.status, trialEndsAt: tenants.trialEndsAt, subscriptionEndsAt: tenants.subscriptionEndsAt }).from(tenants).where(and(gt(tenants.id, cursor), inArray(tenants.status, ["active_trial", "active", "grace"]))).orderBy(tenants.id).limit(500);
    if (!rows.length) break;
    scanned += rows.length;
    cursor = rows[rows.length - 1]!.id;
    for (const tenant of rows) {
      const nextStatus = deriveTenantBillingStatus(tenant, now, graceDays);
      if (nextStatus === tenant.status) continue;
      const result = await db.update(tenants).set({ status: nextStatus, updatedAt: now }).where(and(eq(tenants.id, tenant.id), eq(tenants.status, tenant.status))).returning({ id: tenants.id });
      if (result.length) updated += 1;
    }
    if (rows.length < 500) break;
  }
  return Response.json({ scanned, updated, graceDays }, { headers: { "Cache-Control": "no-store" } });
}
