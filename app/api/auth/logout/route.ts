import { getRequestContext } from "@cloudflare/next-on-pages";
import { ADMIN_BACKUP_COOKIE, buildExpiredSessionCookie, buildNamedSessionCookie, readSession, SESSION_COOKIE, TOTP_CHALLENGE_COOKIE } from "@/lib/auth";
import { readCookie } from "@/lib/server/session";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRequestContext().env as { KV_BINDING: KVNamespace; SESSION_SECRET?: string };
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionToken = readCookie(cookieHeader, SESSION_COOKIE);
  const backupToken = readCookie(cookieHeader, ADMIN_BACKUP_COOKIE);
  const mainSession = sessionToken && env.SESSION_SECRET ? await readSession(sessionToken, env.SESSION_SECRET) : null;
  const backupSession = backupToken && env.SESSION_SECRET ? await readSession(backupToken, env.SESSION_SECRET) : null;
  if (mainSession?.impersonationId) await env.KV_BINDING.delete(`impersonation:${mainSession.impersonationId}`).catch(() => undefined);
  else if (mainSession) await env.KV_BINDING.delete(`session:${mainSession.sub}`).catch(() => undefined);
  if (backupSession && backupSession.sub !== mainSession?.sub) await env.KV_BINDING.delete(`session:${backupSession.sub}`).catch(() => undefined);

  const headers = new Headers({ Location: new URL("/login", request.url).toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildExpiredSessionCookie(request.url));
  headers.append("Set-Cookie", buildNamedSessionCookie(ADMIN_BACKUP_COOKIE, "", request.url, 0, "Strict"));
  headers.append("Set-Cookie", buildNamedSessionCookie(TOTP_CHALLENGE_COOKIE, "", request.url, 0, "Strict"));
  return new Response(null, { status: 303, headers });
}
