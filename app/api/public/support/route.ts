import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { supportTickets } from "@/lib/db/schema";
import { replyToMessage } from "@/lib/support/chatbot";
import { sendSupportTicketToOwner } from "@/lib/platform/telegram";
import { z } from "zod";
import { eq } from "drizzle-orm";

export const runtime = "edge";
const chatSchema = z.object({ action: z.literal("chat"), message: z.string().trim().min(1).max(1000), language: z.enum(["ar", "en"]) }).strict();
const ticketSchema = z.object({ action: z.literal("ticket"), fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(32).regex(/^[+()\-\s\d]{7,32}$/), activityType: z.string().trim().min(2).max(80), preferredAt: z.coerce.date().nullable().optional(), details: z.string().trim().min(10).max(3000), language: z.enum(["ar", "en"]), source: z.enum(["landing_widget", "dashboard_widget"]).default("landing_widget") }).strict();
function sameOrigin(request: Request): boolean { const origin = request.headers.get("origin"); return !origin || origin === new URL(request.url).origin; }
function ticketError(language: "ar" | "en", message: string) { return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "chat") {
      const parsed = chatSchema.safeParse(body); if (!parsed.success) return ticketError("ar", "أرسل رسالة صحيحة");
      return Response.json(replyToMessage(parsed.data.message, parsed.data.language), { headers: { "Cache-Control": "no-store" } });
    }
    const parsed = ticketSchema.safeParse(body); if (!parsed.success) return ticketError((body?.language === "en" ? "en" : "ar"), body?.language === "en" ? "Check the ticket details and try again." : "تحقق من بيانات التذكرة وحاول مرة أخرى");
    const input = parsed.data; const now = new Date();
    if (input.preferredAt && (input.preferredAt.getTime() < now.getTime() || input.preferredAt.getTime() > now.getTime() + 90 * 86_400_000)) return ticketError(input.language, input.language === "en" ? "Choose a future time within 90 days." : "اختر موعداً مستقبلياً خلال 90 يوماً");
    const db = getDb(); const id = crypto.randomUUID();
    const [created] = await db.insert(supportTickets).values({ id, fullName: input.fullName, phone: input.phone, activityType: input.activityType, preferredAt: input.preferredAt ?? null, details: input.details, language: input.language, source: input.source, status: input.preferredAt ? "scheduled" : "new", notificationStatus: "pending", createdAt: now, updatedAt: now }).returning({ id: supportTickets.id, status: supportTickets.status, preferredAt: supportTickets.preferredAt });
    let notificationStatus: "sent" | "failed" = "failed";
    try {
      const messageId = await sendSupportTicketToOwner(getRuntimeEnv(), { ticketId: id, fullName: input.fullName, phone: input.phone, activityType: input.activityType, preferredAt: input.preferredAt ?? null, details: input.details, language: input.language });
      notificationStatus = "sent";
      await db.update(supportTickets).set({ notificationStatus, notificationMessageId: messageId, notifiedAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, id)).run();
    } catch (error) {
      await db.update(supportTickets).set({ notificationStatus, notificationLastError: error instanceof Error ? error.message.slice(0, 240) : "notification failed", updatedAt: new Date() }).where(eq(supportTickets.id, id)).run();
    }
    return Response.json({ ticket: created, notificationStatus, message: input.language === "en" ? "Your support request was submitted." : "تم إرسال طلب الدعم بنجاح." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "تعذر تنفيذ طلب الدعم" }, { status: 500 }); }
}
