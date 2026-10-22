import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { featureRequests, tenants, users } from "@/lib/db/schema";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const statusSchema = z.object({ status: z.enum(["new", "under_review", "planned", "declined", "completed"]), adminNote: z.string().trim().max(1000).nullable().optional() }).strict();

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const rows = await access.context.db.select({ id: featureRequests.id, title: featureRequests.title, description: featureRequests.description, status: featureRequests.status, adminNote: featureRequests.adminNote, createdAt: featureRequests.createdAt, updatedAt: featureRequests.updatedAt, tenantName: tenants.name, tenantSlug: tenants.slug, submittedByName: users.fullName }).from(featureRequests).innerJoin(tenants, eq(tenants.id, featureRequests.tenantId)).innerJoin(users, eq(users.id, featureRequests.submittedBy)).orderBy(desc(featureRequests.createdAt)).limit(200);
  return Response.json({ requests: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "معرف الاقتراح مطلوب" }, { status: 400 });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "حالة الاقتراح أو الملاحظة غير صالحة" }, { status: 400 });
  const now = new Date();
  const [updated] = await access.context.db.update(featureRequests).set({ status: parsed.data.status, adminNote: parsed.data.adminNote ?? null, reviewedBy: access.context.user.id, reviewedAt: now, updatedAt: now }).where(eq(featureRequests.id, id)).returning({ id: featureRequests.id, status: featureRequests.status, adminNote: featureRequests.adminNote, updatedAt: featureRequests.updatedAt });
  if (!updated) return Response.json({ error: "الاقتراح غير موجود" }, { status: 404 });
  await writePlatformAudit(access.context, request, "platform.feature_request_reviewed", "feature_request", id, { status: updated.status });
  return Response.json({ request: updated }, { headers: { "Cache-Control": "no-store" } });
}
