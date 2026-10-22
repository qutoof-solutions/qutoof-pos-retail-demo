import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_BACKUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { tenants, users } from "@/lib/db/schema";
import type { OperationContext } from "@/lib/server/operations";
import { deriveTenantBillingStatus } from "@/lib/platform/billing";
import { resolveAuthenticatedSession } from "@/lib/server/session";
import { repairBusinessAdminWorkspaceMembership } from "@/lib/server/workspace-membership";

/**
 * React cache is scoped to the current Server Component render/request. The
 * dashboard layout and page both call this function; sharing this result avoids
 * duplicate session, KV, D1, and workspace-repair work without caching user data
 * across requests.
 */
export const getPageContext = cache(async function getPageContext(): Promise<OperationContext> {
  const env = getRuntimeEnv();
  const cookieStore = await cookies();
  const session = await resolveAuthenticatedSession(cookieStore.get(SESSION_COOKIE)?.value ?? null, cookieStore.get(ADMIN_BACKUP_COOKIE)?.value ?? null, env);
  if (!session || !session.tenantId) redirect("/login");
  const db = getDb();
  const [user] = await db.select().from(users).where(and(eq(users.id, session.sub), eq(users.tenantId, session.tenantId), eq(users.isActive, true))).limit(1);
  if (!user || user.role !== session.role) redirect("/login");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) redirect("/login");
  if (!session.impersonationId) {
    try {
      await repairBusinessAdminWorkspaceMembership({ id: user.id, tenantId: tenant.id, role: user.role });
    } catch {
      console.error("[workspace-membership] self-heal attempt failed");
    }
  }
  const status = deriveTenantBillingStatus(tenant);
  const effectiveTenant = status === tenant.status ? tenant : { ...tenant, status };
  if (status !== tenant.status) await db.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, tenant.id)).run();
  return { db, env, session, tenantId: tenant.id, tenant: effectiveTenant, user };
});
