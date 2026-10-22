import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { strongPasswordSchema } from "@/lib/password-policy";
import { authAttemptKeys, clearAuthFailures, isAuthRateLimited, recordAuthFailure } from "@/lib/server/auth-rate-limit";
import { hasUsableRecoveryCode, resetPasswordWithRecovery } from "@/lib/server/recovery";
import { rotateUserAuthGenerationBeforeCredentialMutation } from "@/lib/server/session";
import { hashRecoveryCode } from "@/lib/totp";

export const runtime = "edge";
const inputSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  recoveryCode: z.string().trim().min(12).max(32),
  newPassword: strongPasswordSchema,
  confirmPassword: z.string().min(12).max(128),
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) context.addIssue({ code: "custom", path: ["confirmPassword"], message: "تأكيد كلمة المرور غير مطابق" });
});

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403, headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403, headers: { "Cache-Control": "no-store" } }); }
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "تحقق من بيانات الاستعادة" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const env = getRequestContext().env as { DB: D1Database; KV_BINDING: KVNamespace; SESSION_SECRET?: string };
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503 });
  const keys = await authAttemptKeys(parsed.data.email, request, env.SESSION_SECRET);
  if (await isAuthRateLimited(env.DB, keys)) return Response.json({ error: "تم تجاوز عدد المحاولات؛ انتظر 15 دقيقة ثم حاول مجددًا" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } });

  const user = await env.DB.prepare("SELECT id, tenant_id FROM users WHERE email = ? AND is_active = 1 LIMIT 1")
    .bind(parsed.data.email).first<{ id: string; tenant_id: string | null }>();
  let codeHash = "";
  try { codeHash = await hashRecoveryCode(parsed.data.recoveryCode); }
  catch { /* Keep the public error generic. */ }
  if (!user || !codeHash) {
    await recordAuthFailure(env.DB, keys);
    return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.invalidRecoveryData") }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  let codeIsUsable = false;
  try { codeIsUsable = await hasUsableRecoveryCode(env.DB, user.id, user.tenant_id, codeHash); }
  catch { return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.recoveryVerificationFailed") }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } }); }
  if (!codeIsUsable) {
    await recordAuthFailure(env.DB, keys);
    return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.invalidRecoveryData") }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let passwordHash: string;
  try { passwordHash = await hashPassword(parsed.data.newPassword); }
  catch { return Response.json({ error: "تعذر إعداد كلمة المرور؛ أعد المحاولة" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
  const now = Math.floor(Date.now() / 1000);
  try {
    await rotateUserAuthGenerationBeforeCredentialMutation(env.KV_BINDING, user.id);
    const recovered = await resetPasswordWithRecovery(env.DB, { id: user.id, tenantId: user.tenant_id }, codeHash, passwordHash, now, request.headers.get("user-agent")?.slice(0, 300) ?? null);
    if (!recovered) {
      await recordAuthFailure(env.DB, keys);
      return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.invalidRecoveryData") }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    await clearAuthFailures(env.DB, keys).catch(() => undefined);
    return Response.json({ message: "تم تغيير كلمة المرور. سجّل الدخول بالكلمة الجديدة ثم أدخل رمز المصادقة أو رمز استعادة آخر." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && (error.message === "Unable to revoke user sessions before credential mutation" || error.message === "Unable to read auth generation" || error.message === "Unable to rotate auth generation")) {
      return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.sessionRevocationFailed") }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
    }
    return Response.json({ error: "تعذر إتمام الاستعادة؛ أعد المحاولة" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
