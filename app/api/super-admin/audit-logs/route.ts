import { desc, eq, isNull } from "drizzle-orm";
import { auditLogs, users } from "@/lib/db/schema";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(2000, Number(url.searchParams.get("page") ?? "1") || 1));
  const limit = 50;
  const rows = await access.context.db.select({
    id: auditLogs.id, actorId: auditLogs.actorId, actorName: users.fullName, actorEmail: users.email,
    action: auditLogs.action, resourceType: auditLogs.resourceType, resourceId: auditLogs.resourceId,
    ipAddress: auditLogs.ipAddress, userAgent: auditLogs.userAgent, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt,
  }).from(auditLogs).leftJoin(users, eq(auditLogs.actorId, users.id)).where(isNull(auditLogs.tenantId)).orderBy(desc(auditLogs.createdAt)).limit(limit + 1).offset((page - 1) * limit);
  const hasMore = rows.length > limit;
  return Response.json({ logs: rows.slice(0, limit).map((row) => ({ ...row, metadata: parseMetadata(row.metadataJson) })), page, hasMore }, { headers: { "Cache-Control": "no-store" } });
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
