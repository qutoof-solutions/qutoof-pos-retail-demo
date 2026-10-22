import { z } from "zod";
import { buildSessionCookie, createSession, hashPassword, SESSION_TTL_SECONDS } from "./auth";
import { strongPasswordSchema } from "./password-policy";
import { VERTICALS } from "./terms";
import { safeTrialDays } from "./platform/billing";
import { readOrCreateUserAuthGeneration } from "./server/session";

export type RegistrationEnv = {
  DB: D1Database;
  KV_BINDING: KVNamespace;
  SESSION_SECRET?: string;
};

const registration = z.object({
  businessName: z.string().trim().min(2).max(120),
  vertical: z.enum(VERTICALS),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: strongPasswordSchema,
});

export async function registerBusiness(request: Request, env: RegistrationEnv): Promise<Response> {
  const parsed = registration.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "بيانات التسجيل غير صحيحة", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503 });

  let registrationEnabled = true;
  try {
    const flag = await env.DB.prepare("SELECT enabled FROM platform_feature_flags WHERE key = 'tenant_registration'").first<{ enabled: number }>();
    registrationEnabled = flag?.enabled !== 0;
  } catch {
    return Response.json({ error: "إعداد التسجيل غير متاح؛ أعد المحاولة لاحقاً" }, { status: 503 });
  }
  if (!registrationEnabled) return Response.json({ error: "تسجيل المنشآت متوقف مؤقتاً" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const { businessName, vertical, fullName, email, password } = parsed.data;
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const initialBranchId = crypto.randomUUID();
  const slugBase = businessName.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "business";
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(password);
  const now = new Date();
  let trialDays = 30;
  try {
    const setting = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = 'trial_days'").first<{ value?: string | number }>();
    trialDays = safeTrialDays(setting?.value);
  } catch {
    // A new signup must remain usable even if the optional platform setting is unavailable.
  }
  const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);

  try {
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO tenants (id, name, slug, vertical, status, trial_started_at, trial_ends_at, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active_trial', ?, ?, 'Africa/Cairo', ?, ?, ?)").bind(tenantId, businessName, slug, vertical, now.getTime(), trialEndsAt.getTime(), JSON.stringify({ onboarding: { required: true, version: 1, completedAt: null } }), now.getTime(), now.getTime()),
      env.DB.prepare("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'business_admin', 1, unixepoch() * 1000, unixepoch() * 1000)").bind(userId, tenantId, email, passwordHash, fullName),
      env.DB.prepare("INSERT INTO branches (id, tenant_id, name, name_ar, name_en, is_active, created_at, updated_at) VALUES (?, ?, 'الفرع الرئيسي', 'الفرع الرئيسي', 'Main branch', 1, unixepoch() * 1000, unixepoch() * 1000)").bind(initialBranchId, tenantId),
      env.DB.prepare("INSERT INTO branch_memberships (id, tenant_id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?, unixepoch() * 1000)").bind(crypto.randomUUID(), tenantId, userId, initialBranchId),
      env.DB.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, 'tenant.registered', 'tenant', ?, ?, unixepoch() * 1000)").bind(crypto.randomUUID(), tenantId, userId, tenantId, JSON.stringify({ initialBranchId })),
    ]);
    if (results.some((result) => !result.success)) throw new Error("Registration batch failed");
  } catch {
    return Response.json({ error: "تعذر إنشاء الحساب؛ تحقق من البيانات وحاول مرة أخرى" }, { status: 409 });
  }

  let authGeneration: string;
  try {
    authGeneration = await readOrCreateUserAuthGeneration(env.KV_BINDING, userId);
    await env.KV_BINDING.put(`session:${userId}`, "active", { expirationTtl: SESSION_TTL_SECONDS });
  } catch {
    return Response.json({ error: "تم إنشاء الحساب، لكن تعذر إنشاء جلسة آمنة؛ سجّل الدخول مجددًا" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const token = await createSession({ sub: userId, tenantId, role: "business_admin", email, fullName, authGeneration }, env.SESSION_SECRET);
  const cookie = buildSessionCookie(token, request.url);
  return Response.json(
    { user: { id: userId, tenantId, email, fullName, role: "business_admin" }, tenant: { id: tenantId, name: businessName, slug, vertical, status: "active_trial", trialStartedAt: now, trialEndsAt, trialDays }, initialBranchId },
    { status: 201, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
  );
}
