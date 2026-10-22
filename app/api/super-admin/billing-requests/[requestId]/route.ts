import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { platformBillingRequests } from "@/lib/db/schema";
import { dispatchBillingNotifications } from "@/lib/platform/telegram-dispatch";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const retrySchema = z.object({ action: z.literal("retry_notification") }).strict();

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { requestId } = await context.params;
  const parsed = retrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "العملية غير صالحة" }, { status: 400 });
  const [billingRequest] = await access.context.db.select({ id: platformBillingRequests.id, status: platformBillingRequests.status, telegramSentAt: platformBillingRequests.telegramSentAt }).from(platformBillingRequests).where(eq(platformBillingRequests.id, requestId)).limit(1);
  if (!billingRequest) return Response.json({ error: "طلب الاشتراك غير موجود" }, { status: 404 });
  if (billingRequest.status !== "pending_review" || billingRequest.telegramSentAt) return Response.json({ error: "لا يمكن إعادة إرسال إشعار لهذا الطلب" }, { status: 409 });
  await access.context.db.update(platformBillingRequests).set({ telegramLeaseUntil: null, telegramAttempts: 0, telegramLastError: null, updatedAt: new Date() }).where(and(eq(platformBillingRequests.id, requestId), eq(platformBillingRequests.status, "pending_review"), isNull(platformBillingRequests.telegramSentAt))).run();
  const result = await dispatchBillingNotifications(1, requestId);
  await writePlatformAudit(access.context, request, "billing.telegram_notification_retried", "platform_billing_request", requestId, { sent: result.sent > 0, deferred: result.deferred > 0 });
  return Response.json({ sent: result.sent > 0, queued: result.deferred > 0 || result.sent === 0 }, { headers: { "Cache-Control": "no-store" } });
}
