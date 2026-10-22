import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appointments, branches, customers, services, tenantPublicProfiles, tenants, whatsappConnections, whatsappNotifications, whatsappSettings } from "@/lib/db/schema";
import { decryptWhatsAppToken, normalizeWhatsAppPhone, whatsappEncryptionKey } from "@/lib/whatsapp/security";
import { deriveTenantBillingStatus, operationalAccessAllowed } from "@/lib/platform/billing";
import { isFeatureEnabled } from "@/lib/platform/features";
import { applyTenantTerms, getTerms, type Vertical } from "@/lib/terms";
import { getReminderSchedule } from "@/lib/whatsapp/reminders";

type Db = ReturnType<typeof getDb>;
type EventKind = "confirmation" | "reminder" | "reminder_3h" | "review";
type Environment = { WHATSAPP_TOKEN_ENCRYPTION_KEY?: string; WHATSAPP_ENCRYPTION_KEY?: string; WHATSAPP_GRAPH_API_VERSION?: string; NEXT_PUBLIC_BASE_URL?: string };

function newId(): string { return crypto.randomUUID(); }

async function isManualWhatsAppMode(db: Db, tenantId: string): Promise<boolean> {
  const [settings] = await db.select({ mode: whatsappSettings.mode }).from(whatsappSettings).where(eq(whatsappSettings.tenantId, tenantId)).limit(1);
  if (settings) return settings.mode === "basic";
  const [connection] = await db.select({ id: whatsappConnections.id }).from(whatsappConnections).where(eq(whatsappConnections.tenantId, tenantId)).limit(1);
  return !connection;
}

async function automatedWhatsAppAllowed(db: Db, tenantId: string): Promise<boolean> {
  return !await isManualWhatsAppMode(db, tenantId);
}

export async function enqueueBookingNotifications(db: Db, input: { tenantId: string; appointmentId: string; customerPhone: string; startsAt: Date; endsAt: Date }): Promise<void> {
  if (!await automatedWhatsAppAllowed(db, input.tenantId)) return;
  const recipientPhone = normalizeWhatsAppPhone(input.customerPhone);
  if (!recipientPhone) return;
  const now = new Date();
  const rows = [
    { eventKind: "confirmation" as const, suffix: "confirmation", scheduledAt: now },
    ...getReminderSchedule(input.startsAt, now).map((reminder) => ({ ...reminder, suffix: `${reminder.eventKind}:${input.startsAt.getTime()}` })),
  ];
  for (const item of rows) await db.insert(whatsappNotifications).values({ id: newId(), tenantId: input.tenantId, appointmentId: input.appointmentId, eventKind: item.eventKind, dedupeKey: `${input.appointmentId}:${item.suffix}`, recipientPhone, scheduledAt: item.scheduledAt, nextAttemptAt: item.scheduledAt, status: "queued", attempts: 0, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [whatsappNotifications.tenantId, whatsappNotifications.dedupeKey] }).run();
}

export async function rescheduleBookingNotifications(db: Db, input: { tenantId: string; appointmentId: string; customerPhone: string; startsAt: Date; endsAt: Date }): Promise<void> {
  const now = new Date();
  await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, updatedAt: now }).where(and(eq(whatsappNotifications.tenantId, input.tenantId), eq(whatsappNotifications.appointmentId, input.appointmentId), inArray(whatsappNotifications.eventKind, ["reminder", "review"]), inArray(whatsappNotifications.status, ["queued", "processing"])));
  if (!await automatedWhatsAppAllowed(db, input.tenantId)) return;
  const recipientPhone = normalizeWhatsAppPhone(input.customerPhone);
  if (!recipientPhone) return;
  for (const reminder of getReminderSchedule(input.startsAt, now)) {
    await db.insert(whatsappNotifications).values({ id: newId(), tenantId: input.tenantId, appointmentId: input.appointmentId, eventKind: reminder.eventKind, dedupeKey: `${input.appointmentId}:${reminder.eventKind}:${input.startsAt.getTime()}`, recipientPhone, scheduledAt: reminder.scheduledAt, nextAttemptAt: reminder.scheduledAt, status: "queued", attempts: 0, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [whatsappNotifications.tenantId, whatsappNotifications.dedupeKey] }).run();
  }
  await db.insert(whatsappNotifications).values({ id: newId(), tenantId: input.tenantId, appointmentId: input.appointmentId, eventKind: "confirmation", dedupeKey: `${input.appointmentId}:reschedule:${input.startsAt.getTime()}`, recipientPhone, scheduledAt: now, nextAttemptAt: now, status: "queued", attempts: 0, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [whatsappNotifications.tenantId, whatsappNotifications.dedupeKey] }).run();
}

export async function enqueueReviewNotification(db: Db, input: { tenantId: string; appointmentId: string; customerPhone: string; endsAt: Date }): Promise<void> {
  if (!await automatedWhatsAppAllowed(db, input.tenantId)) return;
  const recipientPhone = normalizeWhatsAppPhone(input.customerPhone);
  if (!recipientPhone) return;
  const now = new Date();
  const scheduledAt = new Date(Math.max(now.getTime(), input.endsAt.getTime() + 60 * 60_000));
  await db.insert(whatsappNotifications).values({ id: newId(), tenantId: input.tenantId, appointmentId: input.appointmentId, eventKind: "review", dedupeKey: `${input.appointmentId}:review:${input.endsAt.getTime()}`, recipientPhone, scheduledAt, nextAttemptAt: scheduledAt, status: "queued", attempts: 0, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [whatsappNotifications.tenantId, whatsappNotifications.dedupeKey] }).run();
}

export async function cancelPendingAppointmentNotifications(db: Db, tenantId: string, appointmentId: string): Promise<void> {
  await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, updatedAt: new Date() }).where(and(eq(whatsappNotifications.tenantId, tenantId), eq(whatsappNotifications.appointmentId, appointmentId), inArray(whatsappNotifications.status, ["queued", "processing"])));
}

export function localDateAndTime(value: Date, timezone: string, locale: "ar" | "en" = "ar"): { date: string; time: string } {
  const intlLocale = locale === "en" ? "en-GB" : "ar-EG";
  const date = new Intl.DateTimeFormat(intlLocale, { timeZone: timezone, dateStyle: "full" }).format(value);
  const time = new Intl.DateTimeFormat(intlLocale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
  return { date, time };
}

export const WHATSAPP_MAX_ATTEMPTS = 8;
export function canRetryWhatsAppNotification(status: string, attempts: number): boolean {
  return (status === "failed" || status === "cancelled") && Number.isFinite(attempts) && attempts >= 0;
}

function templateFor(kind: EventKind, config: typeof whatsappConnections.$inferSelect): string {
  if (kind === "confirmation") return config.confirmationTemplate;
  if (kind === "reminder") return config.reminderTemplate;
  if (kind === "reminder_3h") return config.reminderThreeHourTemplate;
  return config.reviewTemplate;
}

async function sendTemplate(env: Environment, row: {
  notification: typeof whatsappNotifications.$inferSelect;
  connection: typeof whatsappConnections.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  profile: typeof tenantPublicProfiles.$inferSelect | null;
  appointment: typeof appointments.$inferSelect;
  customer: typeof customers.$inferSelect;
  service: typeof services.$inferSelect;
  branch: typeof branches.$inferSelect | null;
}): Promise<{ ok: true; messageId: string } | { ok: false; retryable: boolean; error: string }> {
  let token: string;
  try { token = await decryptWhatsAppToken(row.connection.accessTokenCiphertext, row.connection.accessTokenNonce, whatsappEncryptionKey(env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? env.WHATSAPP_ENCRYPTION_KEY)); }
  catch { return { ok: false, retryable: false, error: "تعذر فك تشفير بيانات اتصال WhatsApp؛ أعد حفظ الاتصال" }; }

  const at = localDateAndTime(row.appointment.startsAt, row.tenant.timezone);
  const baseUrl = env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if ((row.notification.eventKind !== "review") && (!baseUrl || !row.appointment.publicBookingCode)) return { ok: false, retryable: true, error: "عنوان التطبيق أو رمز الحجز العام غير مضبوط" };
  const bookingUrl = row.appointment.publicBookingCode && baseUrl ? `${baseUrl}/${encodeURIComponent(row.tenant.slug)}/booking/${encodeURIComponent(row.appointment.publicBookingCode)}` : "";
  const reviewUrl = row.profile?.googleReviewUrl ?? "";
  if (row.notification.eventKind === "review" && !reviewUrl) return { ok: false, retryable: false, error: "لم يضبط النشاط رابط تقييم Google" };

  const vertical = row.tenant.vertical as Vertical;
  const serviceLabel = `${getTerms(vertical).appointment}: ${applyTenantTerms(row.service.name, vertical)}`;
  const bodyValues = row.notification.eventKind === "review"
    ? [row.customer.fullName, serviceLabel, reviewUrl]
    : [row.customer.fullName, serviceLabel, at.date, at.time, row.branch?.name ?? row.tenant.name, bookingUrl];
  const components: Array<Record<string, unknown>> = [{ type: "body", parameters: bodyValues.map((text) => ({ type: "text", text })) }];
  if ((row.notification.eventKind === "reminder" || row.notification.eventKind === "reminder_3h") && row.appointment.publicBookingCode) {
    components.push({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `confirm:${row.appointment.publicBookingCode}` }] });
    components.push({ type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `reschedule:${row.appointment.publicBookingCode}` }] });
    if (row.notification.eventKind === "reminder_3h") components.push({ type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: `cancel:${row.appointment.publicBookingCode}` }] });
  }
  const message = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: row.notification.recipientPhone,
    type: "template",
    biz_opaque_callback_data: row.notification.id,
    template: { name: templateFor(row.notification.eventKind, row.connection), language: { code: row.connection.languageCode }, components },
  };
  const version = env.WHATSAPP_GRAPH_API_VERSION && /^v\d{2,3}\.\d$/.test(env.WHATSAPP_GRAPH_API_VERSION) ? env.WHATSAPP_GRAPH_API_VERSION : "v23.0";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(row.connection.phoneNumberId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(message), signal: controller.signal });
    const json = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } | null;
    const messageId = json?.messages?.[0]?.id;
    if (response.ok && messageId) return { ok: true, messageId };
    const error = String(json?.error?.message ?? `WhatsApp API returned HTTP ${response.status}`).slice(0, 400);
    return { ok: false, retryable: response.status === 429 || response.status >= 500, error };
  } catch (error) {
    const message = error instanceof Error ? error.name === "AbortError" ? "انتهت مهلة WhatsApp API" : error.message : "فشل الاتصال بـ WhatsApp API";
    return { ok: false, retryable: true, error: message.slice(0, 400) };
  } finally { clearTimeout(timeout); }
}

async function loadDispatchRow(db: Db, notificationId: string) {
  const rows = await db.select({
    notification: whatsappNotifications,
    connection: whatsappConnections,
    tenant: tenants,
    profile: tenantPublicProfiles,
    appointment: appointments,
    customer: customers,
    service: services,
    branch: branches,
  }).from(whatsappNotifications)
    .innerJoin(whatsappConnections, and(eq(whatsappConnections.tenantId, whatsappNotifications.tenantId), eq(whatsappConnections.isActive, true)))
    .innerJoin(tenants, eq(tenants.id, whatsappNotifications.tenantId))
    .innerJoin(appointments, and(eq(appointments.id, whatsappNotifications.appointmentId), eq(appointments.tenantId, whatsappNotifications.tenantId)))
    .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, whatsappNotifications.tenantId)))
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, whatsappNotifications.tenantId)))
    .leftJoin(tenantPublicProfiles, eq(tenantPublicProfiles.tenantId, whatsappNotifications.tenantId))
    .leftJoin(branches, and(eq(branches.id, appointments.branchId), eq(branches.tenantId, whatsappNotifications.tenantId)))
    .where(eq(whatsappNotifications.id, notificationId)).limit(1);
  return rows[0] ?? null;
}

export async function dispatchOneWhatsAppNotification(db: Db, env: Environment, notificationId: string): Promise<"sent" | "queued" | "failed" | "skipped"> {
  const [owner] = await db.select({ tenantId: whatsappNotifications.tenantId }).from(whatsappNotifications).where(eq(whatsappNotifications.id, notificationId)).limit(1);
  if (owner && await isManualWhatsAppMode(db, owner.tenantId)) {
    await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, lastError: "الإرسال التلقائي متوقف في الوضع البسيط؛ استخدم رابط wa.me اليدوي", updatedAt: new Date() }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "skipped";
  }
  const now = new Date();
  const [claimed] = await db.update(whatsappNotifications).set({ status: "processing", leaseUntil: new Date(now.getTime() + 90_000), updatedAt: now }).where(and(
    eq(whatsappNotifications.id, notificationId), lte(whatsappNotifications.nextAttemptAt, now),
    or(eq(whatsappNotifications.status, "queued"), and(eq(whatsappNotifications.status, "processing"), lte(whatsappNotifications.leaseUntil, now))),
  )).returning({ id: whatsappNotifications.id, attempts: whatsappNotifications.attempts });
  if (!claimed) return "skipped";
  await db.update(whatsappNotifications).set({ attempts: claimed.attempts + 1, updatedAt: now }).where(eq(whatsappNotifications.id, notificationId)).run();
  const row = await loadDispatchRow(db, notificationId);
  if (!row) {
    await db.update(whatsappNotifications).set({ status: "queued", leaseUntil: null, lastError: "اتصال WhatsApp غير مهيأ أو الموعد لم يعد موجوداً", nextAttemptAt: new Date(now.getTime() + 15 * 60_000), updatedAt: now }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "queued";
  }
  if (!operationalAccessAllowed(deriveTenantBillingStatus(row.tenant))) {
    await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, lastError: "اشتراك المنشأة لا يسمح بالإرسال حالياً", updatedAt: new Date() }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "skipped";
  }
  if (["cancelled", "no_show"].includes(row.appointment.status) && row.notification.eventKind !== "review") {
    await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, updatedAt: now }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "skipped";
  }
  if ((row.notification.eventKind === "reminder" || row.notification.eventKind === "reminder_3h") && row.appointment.customerResponse === "confirmed") {
    await db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, updatedAt: now }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "skipped";
  }
  const result = await sendTemplate(env, row);
  if (result.ok) {
    await db.update(whatsappNotifications).set({ status: "sent", providerMessageId: result.messageId, sentAt: new Date(), leaseUntil: null, lastError: null, updatedAt: new Date() }).where(eq(whatsappNotifications.id, notificationId)).run();
    return "sent";
  }
  const retry = result.retryable && claimed.attempts + 1 < 8;
  const delay = Math.min(5 * 60_000 * 2 ** Math.min(claimed.attempts, 6), 6 * 60 * 60_000);
  await db.update(whatsappNotifications).set({ status: retry ? "queued" : "failed", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + delay), lastError: result.error, updatedAt: new Date() }).where(eq(whatsappNotifications.id, notificationId)).run();
  return retry ? "queued" : "failed";
}

export async function dispatchDueWhatsAppNotifications(db: Db, env: Environment, limit = 50): Promise<{ processed: number; sent: number; queued: number; failed: number }> {
  const now = new Date();
  await db.update(appointments).set({ status: "no_show", updatedAt: now }).where(and(inArray(appointments.status, ["pending", "confirmed"]), lte(appointments.endsAt, now))).run();
  if (!await isFeatureEnabled(db, "whatsapp", true)) return { processed: 0, sent: 0, queued: 0, failed: 0 };
  const due = await db.select({ id: whatsappNotifications.id }).from(whatsappNotifications)
    .innerJoin(whatsappConnections, and(eq(whatsappConnections.tenantId, whatsappNotifications.tenantId), eq(whatsappConnections.isActive, true)))
    .where(and(lte(whatsappNotifications.nextAttemptAt, now), or(eq(whatsappNotifications.status, "queued"), and(eq(whatsappNotifications.status, "processing"), lte(whatsappNotifications.leaseUntil, now)))))
    .orderBy(asc(whatsappNotifications.nextAttemptAt)).limit(Math.max(1, Math.min(limit, 100)));
  const result = { processed: 0, sent: 0, queued: 0, failed: 0 };
  for (const item of due) {
    const status = await dispatchOneWhatsAppNotification(db, env, item.id);
    if (status === "skipped") continue;
    result.processed += 1;
    result[status] += 1;
  }
  return result;
}

export async function queueReviewIfCompleted(db: Db, input: { tenantId: string; appointmentId: string }): Promise<void> {
  const [row] = await db.select({ appointment: appointments, customer: customers }).from(appointments)
    .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, appointments.tenantId)))
    .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, input.tenantId), eq(appointments.status, "completed"), eq(appointments.whatsappOptIn, true))).limit(1);
  if (row) await enqueueReviewNotification(db, { tenantId: input.tenantId, appointmentId: input.appointmentId, customerPhone: row.customer.phone, endsAt: row.appointment.endsAt });
}
