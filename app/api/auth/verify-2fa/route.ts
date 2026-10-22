import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { z } from "zod";
import { buildNamedSessionCookie, buildSessionCookie, createSession, readTwoFactorChallenge, SESSION_TTL_SECONDS, TOTP_CHALLENGE_COOKIE } from "@/lib/auth";
import type { AuthRole } from "@/lib/auth";
import { authAttemptKeys, clearAuthFailures, isAuthRateLimited, recordAuthFailure } from "@/lib/server/auth-rate-limit";
import { readOrCreateUserAuthGeneration } from "@/lib/server/session";
import { verifySecondFactor } from "@/lib/server/two-factor";

export const runtime = "edge";
const inputSchema = z.object({ code: z.string().trim().min(6).max(32) });

function getCookie(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

export async function POST(request: Request): Promise<Response> {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "أدخل رمز التحقق" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const env = getRequestContext().env as { DB: D1Database; KV_BINDING: KVNamespace; SESSION_SECRET?: string };
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503 });
  const challenge = getCookie(request, TOTP_CHALLENGE_COOKIE);
  const userId = challenge ? await readTwoFactorChallenge(challenge, env.SESSION_SECRET) : null;
  if (!userId) return Response.json({ error: "انتهت صلاحية التحقق؛ ابدأ تسجيل الدخول من جديد" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const user = await env.DB.prepare("SELECT id, tenant_id, email, full_name, role, is_active, totp_enabled, totp_secret_encrypted FROM users WHERE id = ? LIMIT 1").bind(userId).first<{ id: string; tenant_id: string | null; email: string; full_name: string; role: AuthRole; is_active: number; totp_enabled: number; totp_secret_encrypted: string | null }>();
  if (!user || user.is_active !== 1 || user.totp_enabled !== 1 || !user.totp_secret_encrypted) return fail(request, "تعذر إكمال التحقق؛ ابدأ تسجيل الدخول من جديد", 401);
  const keys = await authAttemptKeys(user.email, request, env.SESSION_SECRET);
  if (await isAuthRateLimited(env.DB, keys)) return Response.json({ error: "تم تجاوز عدد المحاولات؛ انتظر 15 دقيقة ثم حاول مجددًا" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } });

  const result = await verifySecondFactor(env.DB, user.id, user.totp_secret_encrypted, parsed.data.code, env.SESSION_SECRET);
  if (!result.ok) {
    await recordAuthFailure(env.DB, keys);
    return Response.json({ error: "رمز التحقق غير صحيح أو سبق استخدامه" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearAuthFailures(env.DB, keys);
  let authGeneration: string;
  try {
    authGeneration = await readOrCreateUserAuthGeneration(env.KV_BINDING, user.id);
    await env.KV_BINDING.put(`session:${user.id}`, "active", { expirationTtl: SESSION_TTL_SECONDS });
  } catch {
    return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.secureSessionFailed") }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  await env.DB.prepare("UPDATE users SET last_login_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(user.id).run();
  const token = await createSession({ sub: user.id, tenantId: user.tenant_id, role: user.role, email: user.email, fullName: user.full_name, authGeneration }, env.SESSION_SECRET);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildSessionCookie(token, request.url));
  headers.append("Set-Cookie", buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict"));
  return Response.json({ user: { id: user.id, tenantId: user.tenant_id, email: user.email, fullName: user.full_name, role: user.role }, usedRecoveryCode: result.usedRecoveryCode }, { headers });
}

function fail(request: Request, message: string, status: number): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict"));
  return Response.json({ error: message }, { status, headers });
}
