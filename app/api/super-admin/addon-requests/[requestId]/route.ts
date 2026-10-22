import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { platformAddonRequests } from "@/lib/db/schema";
import { reviewAddonRequest } from "@/lib/platform/addon-review";
import { dispatchAddonNotifications } from "@/lib/platform/telegram-dispatch";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const actionSchema = z.object({ action: z.enum(["approve", "reject", "retry_notification"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { requestId } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "العملية غير صالحة" }, { status: 400 });

  if (parsed.data.action === "retry_notification") {
    const [row] = await access.context.db.select({ id: platformAddonRequests.id, status: platformAddonRequests.status, telegramSentAt: platformAddonRequests.telegramSentAt }).from(platformAddonRequests).where(eq(platformAddonRequests.id, requestId)).limit(1);
    if (!row) return Response.json({ error: "طلب الإضافة غير موجود" }, { status: 404 });
    if (row.status !== "pending_review" || row.telegramSentAt) return Response.json({ error: "لا يمكن إعادة إرسال إشعار لهذا الطلب" }, { status: 409 });
    await access.context.db.update(platformAddonRequests).set({ telegramLeaseUntil: null, telegramAttempts: 0, telegramLastError: null, updatedAt: new Date() }).where(and(eq(platformAddonRequests.id, requestId), eq(platformAddonRequests.status, "pending_review"), isNull(platformAddonRequests.telegramSentAt))).run();
    const result = await dispatchAddonNotifications(1, requestId);
    await writePlatformAudit(access.context, request, "billing.addon_telegram_notification_retried", "platform_addon_request", requestId, { sent: result.sent > 0, deferred: result.deferred > 0 });
    return Response.json({ sent: result.sent > 0, queued: result.deferred > 0 || result.sent === 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const result = await reviewAddonRequest(access.context.env.DB, requestId, access.context.user.id, parsed.data.action);
  if (result.outcome === "not_found") return Response.json({ error: "طلب الإضافة غير موجود" }, { status: 404 });
  if (result.outcome === "already_processed") return Response.json({ error: "تمت معالجة الطلب بالفعل" }, { status: 409 });
  if (result.outcome === "expired") return Response.json({ error: "انتهت دورة الاشتراك أو تغيرت؛ لم تُفعّل الإضافة" }, { status: 409 });
  return Response.json({ status: result.outcome, invoiceNumber: result.invoiceNumber }, { headers: { "Cache-Control": "no-store" } });
}
