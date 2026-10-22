import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_BACKUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";
import { resolveAuthenticatedSession, resolveSessionFromCookieHeader } from "@/lib/server/session";

export interface SuperAdminContext {
  db: ReturnType<typeof getDb>;
  env: ReturnType<typeof getRuntimeEnv>;
  session: NonNullable<Awaited<ReturnType<typeof resolveAuthenticatedSession>>>;
  user: typeof users.$inferSelect;
}

export type SuperAdminAccess = { ok: true; context: SuperAdminContext } | { ok: false; response: Response };

export async function requireSuperAdminAccess(request: Request): Promise<SuperAdminAccess> {
  const env = getRuntimeEnv();
  const session = await resolveSessionFromCookieHeader(request.headers.get("cookie") ?? "", env);
  if (!session) return { ok: false, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (session.role !== "super_admin" || session.tenantId !== null || session.impersonationId) return { ok: false, response: Response.json({ error: "هذه الوظيفة متاحة لمالك المنصة فقط" }, { status: 403 }) };
  const db = getDb();
  const [user] = await db.select().from(users).where(and(eq(users.id, session.sub), isNull(users.tenantId), eq(users.role, "super_admin"), eq(users.isActive, true))).limit(1);
  if (!user) return { ok: false, response: Response.json({ error: "حساب مالك المنصة غير نشط" }, { status: 403 }) };
  return { ok: true, context: { db, env, session, user } };
}

export async function getSuperAdminPageContext(): Promise<SuperAdminContext> {
  const env = getRuntimeEnv();
  const cookieStore = await cookies();
  const session = await resolveAuthenticatedSession(cookieStore.get(SESSION_COOKIE)?.value ?? null, cookieStore.get(ADMIN_BACKUP_COOKIE)?.value ?? null, env);
  if (!session) redirect("/login");
  if (session.role !== "super_admin" || session.tenantId !== null || session.impersonationId) redirect("/dashboard");
  const db = getDb();
  const [user] = await db.select().from(users).where(and(eq(users.id, session.sub), isNull(users.tenantId), eq(users.role, "super_admin"), eq(users.isActive, true))).limit(1);
  if (!user) redirect("/login");
  return { db, env, session, user };
}

export async function writePlatformAudit(context: SuperAdminContext, request: Request, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await context.db.insert(auditLogs).values({
    id: crypto.randomUUID(), tenantId: null, actorId: context.user.id, action, resourceType, resourceId,
    ipAddress: forwarded?.slice(0, 64) ?? null, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    metadataJson: JSON.stringify(metadata), createdAt: new Date(),
  }).run();
}

export async function requestUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}
