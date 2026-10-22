import { dispatchDueWhatsAppNotifications } from "@/services/whatsapp";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { safeEqual } from "@/lib/whatsapp/security";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  const secret = env.WHATSAPP_CRON_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "مجدول الإشعارات غير مهيأ" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), secret)) return Response.json({ error: "غير مصرح" }, { status: 401 });
  try {
    const result = await dispatchDueWhatsAppNotifications(getDb(), env, 50);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر تصريف صندوق الإشعارات" }, { status: 500 });
  }
}
