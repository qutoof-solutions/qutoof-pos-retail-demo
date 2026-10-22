import { getRuntimeEnv } from "@/lib/db/client";
import { dispatchAddonNotifications, dispatchBillingNotifications } from "@/lib/platform/telegram-dispatch";
import { safeEqual } from "@/lib/whatsapp/security";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  if (!env.BILLING_CRON_SECRET || env.BILLING_CRON_SECRET.length < 32) return Response.json({ error: "Billing dispatcher is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), env.BILLING_CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const [subscriptions, addons] = await Promise.all([dispatchBillingNotifications(20), dispatchAddonNotifications(20)]);
  return Response.json({ claimed: subscriptions.claimed + addons.claimed, sent: subscriptions.sent + addons.sent, deferred: subscriptions.deferred + addons.deferred, subscriptions, addons }, { headers: { "Cache-Control": "no-store" } });
}
