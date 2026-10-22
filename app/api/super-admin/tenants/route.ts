import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { tenants } from "@/lib/db/schema";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";
const VALID_STATUSES = ["pending_trial", "active_trial", "active", "grace", "frozen", "expired", "cancelled"] as const;

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page") ?? "1") || 1));
  const limit = 50;
  const filters = [];
  if (query) filters.push(or(like(tenants.name, `%${query}%`), like(tenants.slug, `%${query}%`), sql`EXISTS (SELECT 1 FROM users WHERE users.tenant_id = ${tenants.id} AND users.role = 'business_admin' AND users.email LIKE ${`%${query}%`})`)!);
  if (VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) filters.push(eq(tenants.status, status as (typeof VALID_STATUSES)[number]));
  const rows = await access.context.db.select({
    id: tenants.id, name: tenants.name, slug: tenants.slug, vertical: tenants.vertical, status: tenants.status,
    createdAt: tenants.createdAt, trialStartedAt: tenants.trialStartedAt, trialEndsAt: tenants.trialEndsAt, subscriptionEndsAt: tenants.subscriptionEndsAt, platformPlanId: tenants.platformPlanId,
    ownerName: sql<string | null>`(SELECT full_name FROM users WHERE tenant_id = ${tenants.id} AND role = 'business_admin' ORDER BY created_at LIMIT 1)`,
    ownerEmail: sql<string | null>`(SELECT email FROM users WHERE tenant_id = ${tenants.id} AND role = 'business_admin' ORDER BY created_at LIMIT 1)`,
    planName: sql<string | null>`(SELECT name_ar FROM platform_plans WHERE id = ${tenants.platformPlanId})`,
  }).from(tenants).where(filters.length ? and(...filters) : undefined).orderBy(desc(tenants.createdAt)).limit(limit + 1).offset((page - 1) * limit);
  const hasMore = rows.length > limit;
  return Response.json({ tenants: rows.slice(0, limit), page, hasMore }, { headers: { "Cache-Control": "no-store" } });
}
