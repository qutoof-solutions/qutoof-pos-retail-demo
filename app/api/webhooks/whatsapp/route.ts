import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, whatsappConnections, whatsappNotifications, whatsappWebhookEvents } from "@/lib/db/schema";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { hmacSha256Hex, normalizeWhatsAppPhone, safeEqual } from "@/lib/whatsapp/security";
import { cancelPendingAppointmentNotifications } from "@/services/whatsapp";
import { parseAppointmentReply } from "@/lib/whatsapp/actions";

export const runtime = "edge";
const messageSchema = z.object({ id: z.string().min(1).max(200), from: z.string().min(1).max(32), type: z.string().max(40).optional(), button: z.object({ payload: z.string().max(300), text: z.string().max(200).optional() }).optional(), interactive: z.object({ button_reply: z.object({ id: z.string().max(300), title: z.string().max(200).optional() }).optional() }).optional(), text: z.object({ body: z.string().max(1000) }).optional() }).passthrough();
const statusSchema = z.object({ id: z.string().min(1).max(200), status: z.enum(["sent", "delivered", "read", "failed"]), timestamp: z.string().optional(), errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() }).passthrough()).optional() }).passthrough();
const changeSchema = z.object({ value: z.object({ metadata: z.object({ phone_number_id: z.string().min(1).max(100) }).passthrough(), messages: z.array(messageSchema).max(1000).optional(), statuses: z.array(statusSchema).max(1000).optional() }).passthrough() }).passthrough();
const webhookSchema = z.object({ object: z.string(), entry: z.array(z.object({ changes: z.array(changeSchema).max(1000) }).passthrough()).max(1000) }).passthrough();
type WebhookDatabase = ReturnType<typeof getDb>;

async function eventWasProcessed(db: WebhookDatabase, tenantId: string, providerEventId: string): Promise<boolean> {
  const [row] = await db.select({ id: whatsappWebhookEvents.id }).from(whatsappWebhookEvents).where(and(eq(whatsappWebhookEvents.tenantId, tenantId), eq(whatsappWebhookEvents.providerEventId, providerEventId))).limit(1);
  return Boolean(row);
}

async function recordProcessedEvent(db: WebhookDatabase, tenantId: string, providerEventId: string, eventType: string): Promise<void> {
  await db.insert(whatsappWebhookEvents).values({ id: crypto.randomUUID(), tenantId, providerEventId, eventType, createdAt: new Date(), processedAt: new Date() }).onConflictDoNothing().run();
}

export async function GET(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!env.WHATSAPP_VERIFY_TOKEN || mode !== "subscribe" || !token || !challenge || !safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  if (!env.WHATSAPP_APP_SECRET) return Response.json({ error: "Webhook غير مهيأ" }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1_000_000) return Response.json({ error: "حجم webhook يتجاوز الحد" }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) return Response.json({ error: "حجم webhook يتجاوز الحد" }, { status: 413 });
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match || !safeEqual((await hmacSha256Hex(env.WHATSAPP_APP_SECRET, rawBody)).toLowerCase(), match[1]!.toLowerCase())) return Response.json({ error: "توقيع webhook غير صالح" }, { status: 401 });
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return Response.json({ error: "JSON غير صالح" }, { status: 400 }); }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "مخطط webhook غير معروف" }, { status: 400 });
  const db = getDb();
  try {
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const phoneNumberId = change.value.metadata.phone_number_id;
        const [connection] = await db.select({ tenantId: whatsappConnections.tenantId }).from(whatsappConnections).where(and(eq(whatsappConnections.phoneNumberId, phoneNumberId), eq(whatsappConnections.isActive, true))).limit(1);
        if (!connection) continue;
        for (const item of change.value.statuses ?? []) {
          const providerEventId = `${item.id}:${item.status}`;
          if (await eventWasProcessed(db, connection.tenantId, providerEventId)) continue;
          const state = item.status === "failed" ? "failed" : item.status;
          await db.update(whatsappNotifications).set({ status: state, lastError: item.errors?.[0]?.message?.slice(0, 400) ?? null, updatedAt: new Date() }).where(and(eq(whatsappNotifications.tenantId, connection.tenantId), eq(whatsappNotifications.providerMessageId, item.id))).run();
          await recordProcessedEvent(db, connection.tenantId, providerEventId, `status.${item.status}`);
        }
        for (const message of change.value.messages ?? []) {
          if (await eventWasProcessed(db, connection.tenantId, message.id)) continue;
          const sender = normalizeWhatsAppPhone(message.from);
          const body = message.button?.payload ?? message.interactive?.button_reply?.id ?? message.text?.body?.trim() ?? "";
          const matchAction = parseAppointmentReply(body);
          if (!sender || !matchAction) {
            await recordProcessedEvent(db, connection.tenantId, message.id, `message.${message.type ?? "unknown"}`);
            continue;
          }
          const action = matchAction.action;
          const code = matchAction.code;
          const [booking] = await db.select({ appointment: appointments, customer: customers }).from(appointments)
            .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, appointments.tenantId)))
            .where(and(eq(appointments.tenantId, connection.tenantId), eq(appointments.publicBookingCode, code), eq(appointments.source, "public_portal"), eq(appointments.whatsappOptIn, true))).limit(1);
          if (!booking) {
            await recordProcessedEvent(db, connection.tenantId, message.id, `message.${message.type ?? "unknown"}`);
            continue;
          }
          if (!["pending", "confirmed"].includes(booking.appointment.status)) {
            await recordProcessedEvent(db, connection.tenantId, message.id, `message.${message.type ?? "unknown"}`);
            continue;
          }
          const now = new Date();
          if (action === "confirm") {
            await db.update(appointments).set({ status: "confirmed", customerResponse: "confirmed", customerResponseAt: now, updatedAt: now }).where(and(eq(appointments.id, booking.appointment.id), eq(appointments.tenantId, connection.tenantId), eq(appointments.status, "pending"))).run();
            if (booking.appointment.status === "confirmed") await db.update(appointments).set({ customerResponse: "confirmed", customerResponseAt: now, updatedAt: now }).where(and(eq(appointments.id, booking.appointment.id), eq(appointments.tenantId, connection.tenantId))).run();
          } else if (action === "cancel") {
            await db.update(appointments).set({ status: "cancelled", cancellationReason: "ألغاه العميل عبر WhatsApp", customerResponse: null, customerResponseAt: now, updatedAt: now }).where(and(eq(appointments.id, booking.appointment.id), eq(appointments.tenantId, connection.tenantId), inArray(appointments.status, ["pending", "confirmed"]))).run();
            await cancelPendingAppointmentNotifications(db, connection.tenantId, booking.appointment.id);
          } else {
            await db.update(appointments).set({ customerResponse: "reschedule_requested", customerResponseAt: now, updatedAt: now }).where(and(eq(appointments.id, booking.appointment.id), eq(appointments.tenantId, connection.tenantId))).run();
          }
          await recordProcessedEvent(db, connection.tenantId, message.id, `message.${message.type ?? "unknown"}`);
        }
      }
    }
    return Response.json({ received: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر حفظ حدث WhatsApp؛ سيعاد الإرسال تلقائياً" }, { status: 500 });
  }
}
