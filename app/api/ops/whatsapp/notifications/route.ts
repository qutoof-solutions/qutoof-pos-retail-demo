import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { whatsappNotifications } from "@/lib/db/schema";
import { canRetryWhatsAppNotification, localDateAndTime } from "@/services/whatsapp";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";
const retrySchema = z.object({ id: z.string().min(1).max(128) });
const localeSchema = z.enum(["ar", "en"]).catch("ar");

function localizedDates(value: Date | null, timezone: string, locale: "ar" | "en") {
  if (!value) return null;
  const formatted = localDateAndTime(value, timezone, locale);
  return { iso: value.toISOString(), ...formatted };
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `••••${phone.slice(-4)}` : "••••";
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const params = new URL(request.url).searchParams;
  const locale = localeSchema.parse(params.get("locale") ?? "ar");
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 25) || 25, 1), 100);
  const rows = await access.context.db.select().from(whatsappNotifications)
    .where(eq(whatsappNotifications.tenantId, access.context.tenantId))
    .orderBy(desc(whatsappNotifications.createdAt)).limit(limit);
  return Response.json({
    locale,
    notifications: rows.map((row) => ({
      id: row.id,
      appointmentId: row.appointmentId,
      eventKind: row.eventKind,
      status: row.status,
      attempts: row.attempts,
      recipientPhone: maskPhone(row.recipientPhone),
      providerMessageId: row.providerMessageId,
      lastError: row.lastError,
      canRetry: canRetryWhatsAppNotification(row.status, row.attempts),
      scheduledAt: localizedDates(row.scheduledAt, access.context.tenant.timezone, locale),
      nextAttemptAt: localizedDates(row.nextAttemptAt, access.context.tenant.timezone, locale),
      sentAt: localizedDates(row.sentAt, access.context.tenant.timezone, locale),
      createdAt: localizedDates(row.createdAt, access.context.tenant.timezone, locale),
      updatedAt: localizedDates(row.updatedAt, access.context.tenant.timezone, locale),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = retrySchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid WhatsApp notification id", 400);
    const now = new Date();
    const [existing] = await access.context.db.select({ id: whatsappNotifications.id, status: whatsappNotifications.status, attempts: whatsappNotifications.attempts })
      .from(whatsappNotifications)
      .where(and(eq(whatsappNotifications.id, parsed.data.id), eq(whatsappNotifications.tenantId, access.context.tenantId)))
      .limit(1);
    if (!existing) throw new ApiError("WhatsApp notification not found", 404);
    if (!canRetryWhatsAppNotification(existing.status, existing.attempts)) throw new ApiError("Only failed or cancelled notifications can be retried", 409);
    const [updated] = await access.context.db.update(whatsappNotifications).set({ status: "queued", attempts: 0, leaseUntil: null, nextAttemptAt: now, lastError: null, updatedAt: now })
      .where(and(eq(whatsappNotifications.id, existing.id), eq(whatsappNotifications.tenantId, access.context.tenantId), inArray(whatsappNotifications.status, ["failed", "cancelled"])))
      .returning({ id: whatsappNotifications.id, status: whatsappNotifications.status, nextAttemptAt: whatsappNotifications.nextAttemptAt });
    if (!updated) throw new ApiError("Notification changed; refresh and try again", 409);
    await writeAudit(access.context, request, "whatsapp.notification_retried", "whatsapp_notification", updated.id, { previousStatus: existing.status, previousAttempts: existing.attempts });
    return Response.json({ retried: true, notification: updated }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
