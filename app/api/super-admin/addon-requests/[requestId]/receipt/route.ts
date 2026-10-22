import { eq } from "drizzle-orm";
import { platformAddonRequests } from "@/lib/db/schema";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const { requestId } = await context.params;
  const [row] = await access.context.db.select({ objectKey: platformAddonRequests.receiptObjectKey, contentType: platformAddonRequests.receiptContentType, size: platformAddonRequests.receiptSize, tenantId: platformAddonRequests.tenantId }).from(platformAddonRequests).where(eq(platformAddonRequests.id, requestId)).limit(1);
  if (!row) return Response.json({ error: "إيصال الإضافة غير موجود" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!access.context.env.FILES) return Response.json({ error: "خدمة حفظ الإيصالات غير مهيأة" }, { status: 503 });
  const object = await access.context.env.FILES.get(row.objectKey) as unknown as { customMetadata?: Record<string, string>; body: ReadableStream<Uint8Array> | null } | null;
  if (!object || object.customMetadata?.tenantId !== row.tenantId || object.customMetadata?.requestId !== requestId) return Response.json({ error: "ملف الإيصال غير متاح" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({
    "Content-Type": row.contentType,
    "Content-Length": String(row.size),
    "Content-Disposition": `attachment; filename="addon-receipt-${requestId}.${extension(row.contentType)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  return new Response(object.body, { headers });
}

function extension(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}
