import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ADMIN_BACKUP_COOKIE, buildNamedSessionCookie, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { tenants, users } from "@/lib/db/schema";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";
import { readCookie, readOrCreateUserAuthGeneration } from "@/lib/server/session";

export const runtime = "edge";
const bodySchema = z.object({ tenantId: z.string().uuid() }).strict();
const IMPERSONATION_TTL_SECONDS = 15 * 60;

export async function POST(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  if (!access.context.env.SESSION_SECRET || access.context.env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة الجلسات غير مهيأة" }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "معرف المنشأة غير صالح" }, { status: 400 });
  const [tenant] = await access.context.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, parsed.data.tenantId)).limit(1);
  if (!tenant) return Response.json({ error: "المنشأة غير موجودة" }, { status: 404 });
  const [target] = await access.context.db.select({ id: users.id, tenantId: users.tenantId, email: users.email, fullName: users.fullName, role: users.role }).from(users).where(and(eq(users.tenantId, tenant.id), eq(users.role, "business_admin"), eq(users.isActive, true))).orderBy(asc(users.createdAt)).limit(1);
  if (!target || !target.tenantId) return Response.json({ error: "لا يوجد مدير نشط لهذه المنشأة" }, { status: 409 });
  const impersonationId = crypto.randomUUID();
  const originalToken = readCookie(request.headers.get("cookie") ?? "", SESSION_COOKIE);
  if (!originalToken) return Response.json({ error: "تعذر حفظ جلسة المالك" }, { status: 401 });
  let targetAuthGeneration: string;
  try { targetAuthGeneration = await readOrCreateUserAuthGeneration(access.context.env.KV_BINDING, target.id); }
  catch { return Response.json({ error: serverMessage(request, "p1Server.superAdmin.previewSessionFailed") }, { status: 503 }); }
  const impersonationToken = await createSession({ sub: target.id, tenantId: target.tenantId, role: "business_admin", email: target.email, fullName: target.fullName, authGeneration: targetAuthGeneration, impersonationId, impersonatorId: access.context.user.id }, access.context.env.SESSION_SECRET);
  try { await access.context.env.KV_BINDING.put(`impersonation:${impersonationId}`, JSON.stringify({ actorId: access.context.user.id, tenantId: tenant.id, targetUserId: target.id, startedAt: new Date().toISOString() }), { expirationTtl: IMPERSONATION_TTL_SECONDS }); }
  catch { return Response.json({ error: serverMessage(request, "p1Server.superAdmin.previewSessionFailed") }, { status: 503 }); }
  try {
    await writePlatformAudit(access.context, request, "tenant.impersonation_started", "tenant", tenant.id, { impersonationId, targetUserId: target.id });
  } catch {
    await access.context.env.KV_BINDING.delete(`impersonation:${impersonationId}`);
    return Response.json({ error: "تعذر تسجيل حدث الدعم؛ لم تبدأ الجلسة" }, { status: 503 });
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildNamedSessionCookie(SESSION_COOKIE, impersonationToken, request.url, IMPERSONATION_TTL_SECONDS, "Lax"));
  headers.append("Set-Cookie", buildNamedSessionCookie(ADMIN_BACKUP_COOKIE, originalToken, request.url, SESSION_TTL_SECONDS, "Strict"));
  return Response.json({ redirectTo: "/dashboard", expiresInSeconds: IMPERSONATION_TTL_SECONDS }, { headers });
}
