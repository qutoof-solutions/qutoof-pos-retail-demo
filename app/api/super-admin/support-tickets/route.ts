import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { supportTickets } from "@/lib/db/schema";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";
import { getRuntimeEnv } from "@/lib/db/client";
import { sendSupportTicketToOwner } from "@/lib/platform/telegram";

export const runtime = "edge";
const updateSchema = z.object({ status: z.enum(["new", "in_review", "scheduled", "in_progress", "resolved", "closed"]).optional(), adminNote: z.string().trim().max(1000).nullable().optional(), resendNotification: z.boolean().optional() }).strict();
export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request); if (!access.ok) return access.response;
  const rows = await access.context.db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(300);
  return Response.json({ tickets: rows }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request); if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id"); if (!id) return Response.json({ error: "معرف التذكرة مطلوب" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "بيانات التذكرة غير صالحة" }, { status: 400 });
  const [existing] = await access.context.db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1); if (!existing) return Response.json({ error: "التذكرة غير موجودة" }, { status: 404 });
  const now = new Date();
  const [updated] = await access.context.db.update(supportTickets).set({ status: parsed.data.status ?? existing.status, adminNote: parsed.data.adminNote === undefined ? existing.adminNote : parsed.data.adminNote, updatedAt: now }).where(eq(supportTickets.id, id)).returning();
  if (parsed.data.resendNotification) {
    try {
      const messageId = await sendSupportTicketToOwner(getRuntimeEnv(), { ticketId: existing.id, fullName: existing.fullName, phone: existing.phone, activityType: existing.activityType, preferredAt: existing.preferredAt, details: existing.details, language: existing.language });
      await access.context.db.update(supportTickets).set({ notificationStatus: "sent", notificationMessageId: messageId, notificationLastError: null, notifiedAt: now, updatedAt: new Date() }).where(eq(supportTickets.id, id)).run();
    } catch (error) {
      await access.context.db.update(supportTickets).set({ notificationStatus: "failed", notificationLastError: error instanceof Error ? error.message.slice(0, 240) : "notification failed", updatedAt: new Date() }).where(eq(supportTickets.id, id)).run();
    }
  }
  await writePlatformAudit(access.context, request, "platform.support_ticket_updated", "support_ticket", id, { status: updated?.status ?? existing.status, resent: Boolean(parsed.data.resendNotification) });
  return Response.json({ ticket: updated }, { headers: { "Cache-Control": "no-store" } });
}
