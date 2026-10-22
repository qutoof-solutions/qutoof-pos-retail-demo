import { z } from "zod";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, createTotpUri, hashRecoveryCode, verifyTotp } from "@/lib/totp";
import { verifyPassword } from "@/lib/auth";
import { authAttemptKeys, clearAuthFailures, isAuthRateLimited, recordAuthFailure } from "@/lib/server/auth-rate-limit";
import { verifySecondFactor } from "@/lib/server/two-factor";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), currentPassword: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("verify"), currentPassword: z.string().min(1).max(128), code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("disable"), currentPassword: z.string().min(1).max(128), code: z.string().trim().min(6).max(32) }).strict(),
]);

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", "Pragma": "no-cache" };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  try {
    const user = await access.context.env.DB.prepare("SELECT totp_enabled FROM users WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1").bind(access.context.user.id).first<{ totp_enabled: number }>();
    const recovery = await access.context.env.DB.prepare("SELECT COUNT(*) AS remaining FROM auth_recovery_codes WHERE user_id = ? AND used_at IS NULL").bind(access.context.user.id).first<{ remaining: number }>();
    return Response.json({ enabled: user?.totp_enabled === 1, recoveryCodesRemaining: Number(recovery?.remaining ?? 0) }, { headers: noStoreHeaders() });
  } catch {
    return Response.json({ error: "تعذر تحميل إعدادات التحقق بخطوتين" }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (!sameOrigin(request)) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403, headers: noStoreHeaders() });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "بيانات التحقق بخطوتين غير صالحة" }, { status: 400, headers: noStoreHeaders() });
  const sessionSecret = access.context.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) return Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503, headers: noStoreHeaders() });
  const keys = await authAttemptKeys(access.context.user.email, request, sessionSecret);
  if (await isAuthRateLimited(access.context.env.DB, keys)) return Response.json({ error: "تم تجاوز عدد المحاولات؛ انتظر 15 دقيقة ثم حاول مجددًا" }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "900" } });
  if (!(await verifyPassword(parsed.data.currentPassword, access.context.user.passwordHash))) {
    await recordAuthFailure(access.context.env.DB, keys);
    return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 401, headers: noStoreHeaders() });
  }

  const result = parsed.data.action === "begin"
    ? await beginSetup(request, access, sessionSecret)
    : parsed.data.action === "verify"
      ? await verifySetup(request, access, sessionSecret, parsed.data.code, keys)
      : await disableSetup(request, access, sessionSecret, parsed.data.code, keys);
  if (result.ok) await clearAuthFailures(access.context.env.DB, keys).catch(() => undefined);
  return result;
}

async function beginSetup(request: Request, access: Extract<Awaited<ReturnType<typeof requireSuperAdminAccess>>, { ok: true }>, sessionSecret: string): Promise<Response> {
  if (access.context.user.totpEnabled) return Response.json({ error: "التحقق بخطوتين مفعّل بالفعل" }, { status: 409, headers: noStoreHeaders() });
  const secret = generateTotpSecret();
  let encrypted: string;
  try { encrypted = await encryptTotpSecret(secret, sessionSecret); }
  catch { return Response.json({ error: "تعذر تجهيز مفتاح التحقق" }, { status: 500, headers: noStoreHeaders() }); }
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  try {
    const result = await access.context.env.DB.prepare("UPDATE users SET totp_pending_secret_encrypted = ?, totp_pending_expires_at = ?, updated_at = unixepoch() WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1 AND totp_enabled = 0")
      .bind(encrypted, expiresAt, access.context.user.id).run();
    if (result.meta.changes !== 1) return Response.json({ error: "تغيرت حالة الحساب؛ أعد تحميل إعدادات الأمان" }, { status: 409, headers: noStoreHeaders() });
    return Response.json({ secret, otpauthUrl: createTotpUri(secret, access.context.user.email), expiresAt }, { headers: noStoreHeaders() });
  } catch {
    return Response.json({ error: "تعذر بدء إعداد التحقق بخطوتين" }, { status: 500, headers: noStoreHeaders() });
  }
}

async function verifySetup(request: Request, access: Extract<Awaited<ReturnType<typeof requireSuperAdminAccess>>, { ok: true }>, sessionSecret: string, code: string, keys: readonly [string, string]): Promise<Response> {
  try {
    const pending = await access.context.env.DB.prepare("SELECT totp_pending_secret_encrypted, totp_pending_expires_at FROM users WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1 AND totp_enabled = 0")
      .bind(access.context.user.id).first<{ totp_pending_secret_encrypted: string | null; totp_pending_expires_at: number | null }>();
    const now = Math.floor(Date.now() / 1000);
    if (!pending?.totp_pending_secret_encrypted || !pending.totp_pending_expires_at || pending.totp_pending_expires_at <= now) {
      await access.context.env.DB.prepare("UPDATE users SET totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL WHERE id = ? AND totp_enabled = 0").bind(access.context.user.id).run();
      return Response.json({ error: "انتهت صلاحية الإعداد؛ ابدأ العملية من جديد" }, { status: 410, headers: noStoreHeaders() });
    }
    const secret = await decryptTotpSecret(pending.totp_pending_secret_encrypted, sessionSecret);
    if (!secret || !(await verifyTotp(secret, code))) {
      await recordAuthFailure(access.context.env.DB, keys);
      return Response.json({ error: "رمز التحقق غير صحيح" }, { status: 401, headers: noStoreHeaders() });
    }

    const recoveryCodes = generateRecoveryCodes();
    const rows = await Promise.all(recoveryCodes.map(async (plainCode) => ({ plainCode, codeHash: await hashRecoveryCode(plainCode) })));
    const insertStatements = rows.map(({ codeHash }) => access.context.env.DB.prepare(
      "INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at, used_at, consumption_id) SELECT ?, ?, ?, ?, NULL, NULL WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND totp_secret_encrypted = ? AND totp_enabled = 1)",
    ).bind(crypto.randomUUID(), access.context.user.id, codeHash, now, access.context.user.id, pending.totp_pending_secret_encrypted));
    const statements = [
      access.context.env.DB.prepare("UPDATE users SET totp_secret_encrypted = ?, totp_enabled = 1, totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL, updated_at = ? WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1 AND totp_enabled = 0 AND totp_pending_secret_encrypted = ? AND totp_pending_expires_at > ?")
        .bind(pending.totp_pending_secret_encrypted, now, access.context.user.id, pending.totp_pending_secret_encrypted, now),
      ...insertStatements,
    ];
    const results = await access.context.env.DB.batch(statements);
    if (results[0]?.meta.changes !== 1 || results.slice(1).some((result) => result.meta.changes !== 1)) return Response.json({ error: "تعذر تثبيت التحقق؛ أعد تحميل الصفحة وابدأ من جديد" }, { status: 409, headers: noStoreHeaders() });
    await writePlatformAudit(access.context, request, "super_admin.two_factor_enabled", "user", access.context.user.id).catch(() => undefined);
    return Response.json({ enabled: true, recoveryCodes: rows.map((row) => row.plainCode) }, { headers: noStoreHeaders() });
  } catch {
    return Response.json({ error: "تعذر إكمال إعداد التحقق بخطوتين" }, { status: 500, headers: noStoreHeaders() });
  }
}

async function disableSetup(request: Request, access: Extract<Awaited<ReturnType<typeof requireSuperAdminAccess>>, { ok: true }>, sessionSecret: string, code: string, keys: readonly [string, string]): Promise<Response> {
  try {
    const row = await access.context.env.DB.prepare("SELECT totp_enabled, totp_secret_encrypted FROM users WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1")
      .bind(access.context.user.id).first<{ totp_enabled: number; totp_secret_encrypted: string | null }>();
    if (!row || row.totp_enabled !== 1 || !row.totp_secret_encrypted) return Response.json({ error: "التحقق بخطوتين غير مفعّل" }, { status: 409, headers: noStoreHeaders() });
    const factor = await verifySecondFactor(access.context.env.DB, access.context.user.id, row.totp_secret_encrypted, code, sessionSecret);
    if (!factor.ok) {
      await recordAuthFailure(access.context.env.DB, keys);
      return Response.json({ error: "رمز التحقق أو رمز الاستعادة غير صحيح" }, { status: 401, headers: noStoreHeaders() });
    }
    await access.context.env.DB.batch([
      access.context.env.DB.prepare("UPDATE users SET totp_secret_encrypted = NULL, totp_enabled = 0, totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL, updated_at = unixepoch() WHERE id = ? AND totp_enabled = 1").bind(access.context.user.id),
      access.context.env.DB.prepare("DELETE FROM auth_recovery_codes WHERE user_id = ?").bind(access.context.user.id),
    ]);
    await writePlatformAudit(access.context, request, "super_admin.two_factor_disabled", "user", access.context.user.id).catch(() => undefined);
    return Response.json({ enabled: false, recoveryCodesRemaining: 0 }, { headers: noStoreHeaders() });
  } catch {
    return Response.json({ error: "تعذر تعطيل التحقق بخطوتين" }, { status: 500, headers: noStoreHeaders() });
  }
}
