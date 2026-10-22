import { eq } from "drizzle-orm";
import { platformBillingRequests } from "@/lib/db/schema";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";
type ReceiptObject = { body: ReadableStream<Uint8Array>; customMetadata?: Record<string, string> };

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const { requestId } = await context.params;
  const [billingRequest] = await access.context.db.select({ tenantId: platformBillingRequests.tenantId, objectKey: platformBillingRequests.receiptObjectKey, contentType: platformBillingRequests.receiptContentType, size: platformBillingRequests.receiptSize }).from(platformBillingRequests).where(eq(platformBillingRequests.id, requestId)).limit(1);
  if (!billingRequest) return Response.json({ error: "الإيصال غير موجود" }, { status: 404 });
  const object = await access.context.env.FILES.get(billingRequest.objectKey) as unknown as ReceiptObject | null;
  if (!object || object.customMetadata?.tenantId !== billingRequest.tenantId) return Response.json({ error: "ملف الإيصال غير متاح" }, { status: 404 });
  const extension = billingRequest.contentType === "image/png" ? "png" : billingRequest.contentType === "image/webp" ? "webp" : "jpg";
  return new Response(object.body, { headers: { "Content-Type": billingRequest.contentType, "Content-Length": String(billingRequest.size), "Content-Disposition": `attachment; filename="receipt-${requestId}.${extension}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
