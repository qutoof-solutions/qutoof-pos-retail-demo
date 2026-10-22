import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { platformPlans, platformSettings, tenants } from "@/lib/db/schema";
import { deriveTenantBillingStatus, safeTrialDays } from "@/lib/platform/billing";
import { validateBasePlanSelection } from "@/lib/platform/catalog";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("freeze") }),
  z.object({ action: z.literal("unfreeze") }),
  z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(180) }),
  z.object({ action: z.literal("change_plan"), planId: z.string().trim().min(1).max(128) }),
]);
const statuses = ["pending_trial", "active_trial", "active", "grace", "expired", "cancelled"] as const;

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: serverMessage(request, "p1Server.tenants.forbiddenRequest") }, { status: 403 });
  const { tenantId } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: serverMessage(request, "p1Server.tenants.invalidInput") }, { status: 400 });
  const { db } = access.context;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return Response.json({ error: serverMessage(request, "p1Server.tenants.notFound") }, { status: 404 });
  const now = new Date();
  let auditAction = "";
  let metadata: Record<string, unknown> = {};
  if (parsed.data.action === "freeze") {
    if (tenant.status === "frozen") return Response.json({ error: serverMessage(request, "p1Server.tenants.alreadyFrozen") }, { status: 409 });
    await db.update(tenants).set({ status: "frozen", frozenFromStatus: tenant.status, updatedAt: now }).where(and(eq(tenants.id, tenant.id), eq(tenants.status, tenant.status))).run();
    auditAction = "tenant.frozen"; metadata = { previousStatus: tenant.status };
  } else if (parsed.data.action === "unfreeze") {
    if (tenant.status !== "frozen") return Response.json({ error: serverMessage(request, "p1Server.tenants.notFrozen") }, { status: 409 });
    const previous = statuses.includes(tenant.frozenFromStatus as (typeof statuses)[number]) ? tenant.frozenFromStatus as (typeof statuses)[number] : tenant.subscriptionEndsAt && tenant.subscriptionEndsAt > now ? "active" : tenant.trialEndsAt && tenant.trialEndsAt > now ? "active_trial" : tenant.trialStartedAt ? "expired" : "pending_trial";
    const restoredStatus = deriveTenantBillingStatus({ ...tenant, status: previous }, now);
    await db.update(tenants).set({ status: restoredStatus, frozenFromStatus: null, updatedAt: now }).where(and(eq(tenants.id, tenant.id), eq(tenants.status, "frozen"))).run();
    auditAction = "tenant.unfrozen"; metadata = { restoredStatus };
  } else if (parsed.data.action === "extend_trial") {
    if (tenant.status === "active" && tenant.subscriptionEndsAt && tenant.subscriptionEndsAt > now) return Response.json({ error: serverMessage(request, "p1Server.tenants.paidSubscription") }, { status: 409 });
    const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, "trial_days")).limit(1);
    const configuredDays = safeTrialDays(setting?.value);
    const start = tenant.trialEndsAt && tenant.trialEndsAt > now ? tenant.trialEndsAt : now;
    const end = new Date(start.getTime() + parsed.data.days * 86_400_000);
    const nextStatus = tenant.status === "frozen" ? "frozen" : "active_trial";
    await db.update(tenants).set({ status: nextStatus, frozenFromStatus: tenant.status === "frozen" ? "active_trial" : null, trialStartedAt: tenant.trialStartedAt ?? now, trialEndsAt: end, updatedAt: now }).where(eq(tenants.id, tenant.id)).run();
    auditAction = "tenant.trial_extended"; metadata = { additionalDays: parsed.data.days, trialEndsAt: end.toISOString(), configuredDefaultDays: configuredDays };
  } else {
    const [plan] = await db.select({ id: platformPlans.id, nameAr: platformPlans.nameAr, featuresJson: platformPlans.featuresJson }).from(platformPlans).where(and(eq(platformPlans.id, parsed.data.planId), eq(platformPlans.isActive, true))).limit(1);
    const selection = validateBasePlanSelection(plan);
    if (!selection.ok) {
      if (selection.reason === "missing") return Response.json({ error: serverMessage(request, "p1Server.tenants.basePlanUnavailable") }, { status: 404 });
      return Response.json({ error: serverMessage(request, "p1Server.tenants.resourceAddonPlan") }, { status: 400 });
    }
    await db.update(tenants).set({ platformPlanId: selection.plan.id, updatedAt: now }).where(eq(tenants.id, tenant.id)).run();
    auditAction = "tenant.plan_changed"; metadata = { planId: plan.id, planName: plan.nameAr };
  }
  await writePlatformAudit(access.context, request, auditAction, "tenant", tenant.id, { previousStatus: tenant.status, ...metadata });
  const [updated] = await db.select({ id: tenants.id, status: tenants.status, trialStartedAt: tenants.trialStartedAt, trialEndsAt: tenants.trialEndsAt, subscriptionEndsAt: tenants.subscriptionEndsAt, platformPlanId: tenants.platformPlanId }).from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
  return Response.json({ tenant: updated }, { headers: { "Cache-Control": "no-store" } });
}
