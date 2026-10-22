import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { z } from "zod";
import { buildNamedSessionCookie, buildSessionCookie, createSession, createTwoFactorChallenge, SESSION_TTL_SECONDS, TOTP_CHALLENGE_COOKIE, TOTP_CHALLENGE_TTL_SECONDS, verifyPassword } from "@/lib/auth";
import type { AuthRole } from "@/lib/auth";
import { authAttemptKeys, clearAuthFailures, isAuthRateLimited, recordAuthFailure } from "@/lib/server/auth-rate-limit";
import { readOrCreateUserAuthGeneration } from "@/lib/server/session";

export const runtime = "edge";
const credentials = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) });

export async function POST(request: Request): Promise<Response> {
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status: 400 });
  const env = getRequestContext().env as { DB: D1Database; KV_BINDING: KVNamespace; SESSION_SECRET?: string };
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة المصادقة غير مهيأة" }, { status: 503 });
  const keys = await authAttemptKeys(parsed.data.email, request, env.SESSION_SECRET);
  if (await isAuthRateLimited(env.DB, keys)) return Response.json({ error: "تم تجاوز عدد المحاولات؛ انتظر 15 دقيقة ثم حاول مجددًا" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900", "Set-Cookie": buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict") } });
  const row = await env.DB.prepare("SELECT u.id, u.tenant_id, u.email, u.password_hash, u.full_name, u.role, u.is_active, u.totp_enabled, u.totp_secret_encrypted FROM users u WHERE u.email = ? LIMIT 1").bind(parsed.data.email).first<{ id: string; tenant_id: string | null; email: string; password_hash: string; full_name: string; role: AuthRole; is_active: number; totp_enabled: number; totp_secret_encrypted: string | null }>();
  if (!row || row.is_active !== 1 || !(await verifyPassword(parsed.data.password, row.password_hash))) {
    await recordAuthFailure(env.DB, keys);
    return Response.json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status: 401, headers: { "Cache-Control": "no-store", "Set-Cookie": buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict") } });
  }
  if (row.totp_enabled === 1) {
    if (!row.totp_secret_encrypted) return Response.json({ error: "تعذر إكمال التحقق بخطوتين؛ تواصل مع الدعم الإداري" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const challenge = await createTwoFactorChallenge(row.id, env.SESSION_SECRET);
    return Response.json({ requiresTwoFactor: true }, { headers: { "Set-Cookie": buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, challenge, request.url, TOTP_CHALLENGE_TTL_SECONDS, "Strict"), "Cache-Control": "no-store" } });
  }
  await clearAuthFailures(env.DB, keys);
  let authGeneration: string;
  try {
    authGeneration = await readOrCreateUserAuthGeneration(env.KV_BINDING, row.id);
    await env.KV_BINDING.put(`session:${row.id}`, "active", { expirationTtl: SESSION_TTL_SECONDS });
  } catch {
    return Response.json({ error: serverMessage(request, "p1Server.recoveryCodes.secureSessionFailed") }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const token = await createSession({ sub: row.id, tenantId: row.tenant_id, role: row.role, email: row.email, fullName: row.full_name, authGeneration }, env.SESSION_SECRET);
  await env.DB.prepare("UPDATE users SET last_login_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(row.id).run();
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildSessionCookie(token, request.url));
  headers.append("Set-Cookie", buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict"));
  return Response.json({ user: { id: row.id, tenantId: row.tenant_id, email: row.email, fullName: row.full_name, role: row.role } }, { headers });
}
