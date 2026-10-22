import { and, eq, isNull } from "drizzle-orm";
import { platformSettings, tenants } from "@/lib/db/schema";
import { safeTrialDays } from "@/lib/platform/billing";
import { isFeatureEnabled } from "@/lib/platform/features";
import { requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowBillingAccess: true });
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { db, tenant, tenantId } = access.context;
  if (!await isFeatureEnabled(db, "subscription_billing", true)) return Response.json({ error: "الاشتراكات معطلة مؤقتاً؛ تواصل مع مالك المنصة" }, { status: 503 });
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, "trial_days")).limit(1);
  const trialDays = safeTrialDays(setting?.value);
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
  const result = await db.update(tenants).set({ status: "active_trial", trialStartedAt: now, trialEndsAt, frozenFromStatus: null, updatedAt: now }).where(and(eq(tenants.id, tenantId), eq(tenants.status, "pending_trial"), isNull(tenants.trialStartedAt))).returning({ id: tenants.id });
  if (!result.length) return Response.json({ error: tenant.trialStartedAt ? "تم تفعيل التجربة مسبقاً" : "لا يمكن تفعيل التجربة في حالة الحساب الحالية" }, { status: 409 });
  await writeAudit(access.context, request, "tenant.trial_started", "tenant", tenantId, { durationDays: trialDays, trialEndsAt: trialEndsAt.toISOString() });
  return Response.json({ status: "active_trial", trialStartedAt: now, trialEndsAt, durationDays: trialDays }, { headers: { "Cache-Control": "no-store" } });
}
