import { and, eq, isNull } from "drizzle-orm";
import type { AuthRole, SessionClaims } from "@/lib/auth";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { auditLogs, platformSettings, tenants, users } from "@/lib/db/schema";
import { deriveTenantBillingStatus, operationalAccessAllowed, safeTrialDays } from "@/lib/platform/billing";
import { isFeatureEnabled, isPlanFeatureEnabled } from "@/lib/platform/features";
import { resolveSessionFromCookieHeader } from "@/lib/server/session";
import { canUseOnboardingSetup } from "@/lib/operations/onboarding";
import { isRoleAllowedForOperation } from "@/lib/operations/permissions";
import { sanitizeAuditPayload } from "@/lib/server/audit-privacy";
import { repairBusinessAdminWorkspaceMembership } from "@/lib/server/workspace-membership";

export interface OperationContext {
  db: ReturnType<typeof getDb>;
  env: ReturnType<typeof getRuntimeEnv>;
  session: SessionClaims;
  tenantId: string;
  tenant: typeof tenants.$inferSelect;
  user: typeof users.$inferSelect;
}

export type ApiAccess = { ok: true; context: OperationContext } | { ok: false; response: Response };

import { ApiError } from "@/lib/operations/api-error";
export { ApiError };

export async function requireOperationAccess(request: Request, roles: readonly AuthRole[] = ["business_admin", "reception", "provider"], options: { allowBillingAccess?: boolean; allowOnboardingSetup?: boolean } = {}): Promise<ApiAccess> {
  const env = getRuntimeEnv();
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return { ok: false, response: Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503 }) };
  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = await resolveSessionFromCookieHeader(cookieHeader, env);
  if (!session) return { ok: false, response: Response.json({ error: "انتهت الجلسة؛ سجّل الدخول مجدداً" }, { status: 401 }) };
  if (!isRoleAllowedForOperation(session.role, roles, new URL(request.url).pathname) || !session.tenantId) return { ok: false, response: Response.json({ error: "لا تملك صلاحية لهذه العملية" }, { status: 403 }) };
  const db = getDb();
  if (!options.allowBillingAccess && await isFeatureEnabled(db, "maintenance_mode", false)) return { ok: false, response: Response.json({ error: "النظام في وضع الصيانة؛ حاول لاحقاً" }, { status: 503, headers: { "Cache-Control": "no-store" } }) };
  const [user] = await db.select().from(users).where(and(eq(users.id, session.sub), eq(users.tenantId, session.tenantId), eq(users.isActive, true))).limit(1);
  if (!user || user.role !== session.role) return { ok: false, response: Response.json({ error: "الحساب غير نشط أو بيانات الجلسة غير مطابقة" }, { status: 401 }) };
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) return { ok: false, response: Response.json({ error: "مساحة العمل غير موجودة" }, { status: 404 }) };
  if (!session.impersonationId) {
    try {
      await repairBusinessAdminWorkspaceMembership({ id: user.id, tenantId: tenant.id, role: user.role });
    } catch {
      console.error("[workspace-membership] self-heal attempt failed");
    }
  }
  const activatedTenant = await activatePendingTrialIfNeeded(db, tenant);
  const nextStatus = deriveTenantBillingStatus(activatedTenant);
  const onboardingSetup = options.allowOnboardingSetup === true && canUseOnboardingSetup(activatedTenant.settingsJson, session.role, nextStatus);
  const effectiveTenant = nextStatus === activatedTenant.status ? activatedTenant : { ...activatedTenant, status: nextStatus };
  if (nextStatus !== activatedTenant.status) await db.update(tenants).set({ status: nextStatus, updatedAt: new Date() }).where(eq(tenants.id, activatedTenant.id)).run();
  if (!options.allowBillingAccess && !onboardingSetup && !operationalAccessAllowed(nextStatus)) return { ok: false, response: Response.json({ error: nextStatus === "pending_trial" ? "ابدأ الفترة التجريبية أو اختر باقة لمتابعة استخدام النظام" : nextStatus === "frozen" ? "الحساب مجمّد؛ تواصل مع مالك المنصة" : "انتهت صلاحية الاشتراك؛ راجع صفحة الفوترة" }, { status: 402, headers: { "Cache-Control": "no-store" } }) };
  if (!options.allowBillingAccess && !onboardingSetup) {
    const feature = operationFeature(new URL(request.url).pathname);
    if (feature && !await isPlanFeatureEnabled(db, effectiveTenant.platformPlanId, feature)) return { ok: false, response: Response.json({ error: "هذه الميزة غير مشمولة في باقتك؛ راجع صفحة الفوترة أو تواصل مع مالك المنصة" }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
  }
  return { ok: true, context: { db, env, session, tenantId: effectiveTenant.id, tenant: effectiveTenant, user } };
}

async function activatePendingTrialIfNeeded(db: OperationContext["db"], tenant: typeof tenants.$inferSelect): Promise<typeof tenants.$inferSelect> {
  if (tenant.status !== "pending_trial" || tenant.trialStartedAt || tenant.trialEndsAt) return tenant;
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, "trial_days")).limit(1);
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + safeTrialDays(setting?.value) * 86_400_000);
  const [activated] = await db.update(tenants).set({ status: "active_trial", trialStartedAt: now, trialEndsAt, frozenFromStatus: null, updatedAt: now }).where(and(eq(tenants.id, tenant.id), eq(tenants.status, "pending_trial"), isNull(tenants.trialStartedAt), isNull(tenants.trialEndsAt))).returning();
  if (activated) return activated;
  const [current] = await db.select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
  return current ?? tenant;
}

function operationFeature(pathname: string): string | null {
  if (pathname.startsWith("/api/ops/data-export/invoices")) return "pos";
  if (pathname.startsWith("/api/ops/data-export/reports")) return "reports";
  if (pathname.startsWith("/api/ops/distribution")) return "warehouse";
  if (pathname.startsWith("/api/ops/treasury") || pathname.startsWith("/api/ops/financial-report")) return "reports";
  if (pathname.startsWith("/api/ops/pos")) return "pos";
  if (pathname.startsWith("/api/ops/whatsapp")) return "whatsapp";
  if (pathname.startsWith("/api/ops/branches")) return "branches";
  if (pathname.startsWith("/api/ops/commissions")) return "reports";
  if (pathname.startsWith("/api/ops/reports")) return "reports";
  if (pathname.startsWith("/api/ops/queue")) return "queue";
  if (pathname.startsWith("/api/ops/customer-cheques")) return "pos";
  if (pathname.startsWith("/api/ops/supplier-cheques")) return "warehouse";
  if (["/api/ops/invoices", "/api/ops/settlements", "/api/ops/entitlements"].some((path) => pathname.startsWith(path))) return "pos";
  return null;
}

export function errorResponse(error: unknown, fallback = "تعذر تنفيذ العملية"): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "صيغة البيانات غير صحيحة" }, { status: 400 });
  return Response.json({ error: fallback }, { status: 500 });
}

export async function writeAudit(context: OperationContext, _request: Request, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  const safePayload = sanitizeAuditPayload(resourceType, action, resourceId, metadata);
  await context.db.insert(auditLogs).values({
    id: crypto.randomUUID(), tenantId: context.tenantId, actorId: context.user.id, action, resourceType, resourceId: safePayload.resourceId,
    ipAddress: null, userAgent: null, metadataJson: JSON.stringify({ ...safePayload.metadata, ...(context.session.impersonatorId ? { impersonated: true } : {}) }), createdAt: new Date(),
  }).run();
}
