import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { featureRequests } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";
const requestSchema = z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(2000) }).strict();

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request);
  if (!access.ok) return access.response;
  const rows = await access.context.db.select({ id: featureRequests.id, title: featureRequests.title, description: featureRequests.description, status: featureRequests.status, adminNote: featureRequests.adminNote, createdAt: featureRequests.createdAt, updatedAt: featureRequests.updatedAt }).from(featureRequests).where(eq(featureRequests.tenantId, access.context.tenantId)).orderBy(desc(featureRequests.createdAt)).limit(50);
  return Response.json({ requests: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request);
  if (!access.ok) return access.response;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("اكتب عنوانًا ووصفًا واضحًا للاقتراح");
    const now = new Date();
    const id = crypto.randomUUID();
    const [created] = await access.context.db.insert(featureRequests).values({ id, tenantId: access.context.tenantId, submittedBy: access.context.user.id, title: parsed.data.title, description: parsed.data.description, status: "new", adminNote: null, reviewedBy: null, reviewedAt: null, createdAt: now, updatedAt: now }).returning({ id: featureRequests.id, title: featureRequests.title, description: featureRequests.description, status: featureRequests.status, createdAt: featureRequests.createdAt });
    await writeAudit(access.context, request, "feature_request.created", "feature_request", id, { titleLength: parsed.data.title.length, descriptionLength: parsed.data.description.length });
    return Response.json({ request: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
