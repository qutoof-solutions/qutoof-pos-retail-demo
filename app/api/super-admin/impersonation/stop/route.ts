import { ADMIN_BACKUP_COOKIE, buildNamedSessionCookie, readSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { getRuntimeEnv } from "@/lib/db/client";
import { resolveSessionFromCookieHeader, readCookie } from "@/lib/server/session";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const env = getRuntimeEnv();
  const cookies = request.headers.get("cookie") ?? "";
  const actingSession = await resolveSessionFromCookieHeader(cookies, env);
  if (!actingSession?.impersonationId || !actingSession.impersonatorId) return Response.json({ error: "لا توجد جلسة معاينة نشطة" }, { status: 409 });
  const backupToken = readCookie(cookies, ADMIN_BACKUP_COOKIE);
  if (!backupToken || !env.SESSION_SECRET) return Response.json({ error: "جلسة المالك الأصلية غير متاحة" }, { status: 401 });
  const original = await readSession(backupToken, env.SESSION_SECRET);
  if (!original || original.sub !== actingSession.impersonatorId) return Response.json({ error: "جلسة المالك غير صالحة" }, { status: 401 });
  const adminRequest = new Request(request.url, { headers: { cookie: `${SESSION_COOKIE}=${backupToken}` } });
  const access = await requireSuperAdminAccess(adminRequest);
  if (!access.ok) return access.response;
  try {
    await writePlatformAudit(access.context, request, "tenant.impersonation_stopped", "tenant", actingSession.tenantId, { impersonationId: actingSession.impersonationId, targetUserId: actingSession.sub });
  } catch {
    return Response.json({ error: "تعذر تسجيل إنهاء المعاينة" }, { status: 503 });
  }
  await env.KV_BINDING.delete(`impersonation:${actingSession.impersonationId}`);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildNamedSessionCookie(SESSION_COOKIE, backupToken, request.url, SESSION_TTL_SECONDS, "Lax"));
  headers.append("Set-Cookie", buildNamedSessionCookie(ADMIN_BACKUP_COOKIE, "", request.url, 0, "Strict"));
  return Response.json({ redirectTo: "/super-admin" }, { headers });
}
