import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { whatsappConnections, whatsappNotifications, whatsappSettings } from "@/lib/db/schema";
import { encryptWhatsAppToken, normalizeWhatsAppPhone, whatsappEncryptionKey } from "@/lib/whatsapp/security";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireAllActiveBranchMemberships } from "@/lib/server/branch-access";
import { getDb } from "@/lib/db/client";

export const runtime = "edge";
const nameSchema = z.string().regex(/^[a-z0-9_]{2,128}$/);
const phoneSchema = z.string().trim().min(8).max(32).regex(/^\+?[0-9\s().-]+$/);
const advancedSettingsSchema = z.object({ mode: z.literal("advanced"), phoneNumberId: z.string().trim().min(4).max(80), businessAccountId: z.string().trim().max(80).nullable().optional(), accessToken: z.string().trim().min(1).max(4096).optional(), webhookVerifyToken: z.string().trim().max(4096).nullable().optional(), webhookUrl: z.string().trim().url().max(2048).nullable().optional(), defaultTemplateName: nameSchema.nullable().optional(), confirmationTemplate: nameSchema, reminderTemplate: nameSchema, reminderThreeHourTemplate: nameSchema, reviewTemplate: nameSchema, languageCode: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/) });
const settingsInput = z.discriminatedUnion("mode", [z.object({ mode: z.literal("basic"), basicPhoneNumber: phoneSchema }), advancedSettingsSchema]);

type TableInfoRow = { name?: unknown };

const whatsappFallback = {
  mode: "basic" as const,
  basicPhoneNumber: "",
  advancedAvailable: true,
  metaAvailable: true,
  connection: null,
  appWebhookReady: false,
  encryptionReady: true,
};

async function ensureWhatsAppSchema(db: ReturnType<typeof getDb>): Promise<void> {
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS whatsapp_connections (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, phone_number_id TEXT NOT NULL DEFAULT '', business_account_id TEXT,
    webhook_verify_token TEXT, webhook_url TEXT, default_template_name TEXT,
    access_token_ciphertext TEXT NOT NULL DEFAULT '', access_token_nonce TEXT NOT NULL DEFAULT '',
    confirmation_template TEXT NOT NULL DEFAULT 'qutoof_appointment_confirmation', reminder_template TEXT NOT NULL DEFAULT 'qutoof_appointment_reminder',
    reminder_three_hour_template TEXT NOT NULL DEFAULT 'qutoof_appointment_reminder_3h', review_template TEXT NOT NULL DEFAULT 'qutoof_appointment_review',
    language_code TEXT NOT NULL DEFAULT 'ar', is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`));
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS whatsapp_settings (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'basic', basic_phone_number TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`));
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS whatsapp_notifications (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL, event_kind TEXT NOT NULL, dedupe_key TEXT NOT NULL,
    recipient_phone TEXT NOT NULL, scheduled_at INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, provider_message_id TEXT, last_error TEXT, sent_at INTEGER, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`));
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL, processed_at INTEGER, created_at INTEGER NOT NULL DEFAULT 0
  )`));

  const ensureColumns = async (table: string, columns: Record<string, string>) => {
    const rows = await db.all(sql.raw(`PRAGMA table_info(\"${table}\")`)) as TableInfoRow[];
    if (rows.length === 0) return;
    const existing = new Set(rows.map((row) => String(row.name ?? "")));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) await db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`));
    }
  };

  await ensureColumns("whatsapp_connections", {
    phone_number_id: "TEXT NOT NULL DEFAULT ''", business_account_id: "TEXT", webhook_verify_token: "TEXT", webhook_url: "TEXT", default_template_name: "TEXT",
    access_token_ciphertext: "TEXT NOT NULL DEFAULT ''", access_token_nonce: "TEXT NOT NULL DEFAULT ''", confirmation_template: "TEXT NOT NULL DEFAULT 'qutoof_appointment_confirmation'",
    reminder_template: "TEXT NOT NULL DEFAULT 'qutoof_appointment_reminder'", reminder_three_hour_template: "TEXT NOT NULL DEFAULT 'qutoof_appointment_reminder_3h'", review_template: "TEXT NOT NULL DEFAULT 'qutoof_appointment_review'",
    language_code: "TEXT NOT NULL DEFAULT 'ar'", is_active: "INTEGER NOT NULL DEFAULT 1", created_at: "INTEGER NOT NULL DEFAULT 0", updated_at: "INTEGER NOT NULL DEFAULT 0",
  });
  await ensureColumns("whatsapp_settings", { tenant_id: "TEXT NOT NULL DEFAULT ''", mode: "TEXT NOT NULL DEFAULT 'basic'", basic_phone_number: "TEXT", created_at: "INTEGER NOT NULL DEFAULT 0", updated_at: "INTEGER NOT NULL DEFAULT 0" });
  await ensureColumns("tenants", { trial_started_at: "INTEGER", trial_ends_at: "INTEGER", frozen_from_status: "TEXT" });
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_tenant_uq ON whatsapp_connections (tenant_id)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_phone_id_uq ON whatsapp_connections (phone_number_id)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_settings_tenant_uq ON whatsapp_settings (tenant_id)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notifications_tenant_dedupe_uq ON whatsapp_notifications (tenant_id, dedupe_key)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notifications_provider_id_uq ON whatsapp_notifications (provider_message_id)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_tenant_event_uq ON whatsapp_webhook_events (tenant_id, provider_event_id)"));
}

async function getWhatsAppSettings(request: Request): Promise<Response> {
  const db = getDb();
  try { await ensureWhatsAppSchema(db); } catch { return Response.json(whatsappFallback, { headers: { "Cache-Control": "no-store" } }); }
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    await requireAllActiveBranchMemberships(access.context);
    const [[connection], [settings]] = await Promise.all([
      access.context.db.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, access.context.tenantId)).limit(1),
      access.context.db.select().from(whatsappSettings).where(eq(whatsappSettings.tenantId, access.context.tenantId)).limit(1),
    ]);
    const mode = settings?.mode ?? (connection?.accessTokenCiphertext ? "advanced" : "basic");
    return Response.json({ mode, basicPhoneNumber: settings?.basicPhoneNumber ? `+${settings.basicPhoneNumber}` : "", advancedAvailable: true, metaAvailable: true, connection: connection ? { phoneNumberId: connection.phoneNumberId, businessAccountId: connection.businessAccountId, webhookVerifyToken: connection.webhookVerifyToken, webhookUrl: connection.webhookUrl, defaultTemplateName: connection.defaultTemplateName, confirmationTemplate: connection.confirmationTemplate, reminderTemplate: connection.reminderTemplate, reminderThreeHourTemplate: connection.reminderThreeHourTemplate, reviewTemplate: connection.reviewTemplate, languageCode: connection.languageCode, isActive: connection.isActive, tokenConfigured: Boolean(connection.accessTokenCiphertext) } : null, appWebhookReady: Boolean(access.context.env.WHATSAPP_APP_SECRET && access.context.env.WHATSAPP_VERIFY_TOKEN), encryptionReady: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json(whatsappFallback, { headers: { "Cache-Control": "no-store" } }); }
}

async function putWhatsAppSettings(request: Request): Promise<Response> {
  await ensureWhatsAppSchema(getDb());
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  await requireAllActiveBranchMemberships(access.context);
  try {
    const parsed = settingsInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من رقم WhatsApp أو بيانات الاتصال");
    const input = parsed.data;
    const now = new Date();
    const [existingSetting] = await access.context.db.select().from(whatsappSettings).where(eq(whatsappSettings.tenantId, access.context.tenantId)).limit(1);
    const [existingConnection] = await access.context.db.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, access.context.tenantId)).limit(1);

    if (input.mode === "basic") {
      const normalizedPhone = normalizeWhatsAppPhone(input.basicPhoneNumber);
      if (!normalizedPhone) throw new ApiError("أدخل رقمًا دوليًا صحيحًا من 8 إلى 15 رقمًا");
      await access.context.db.insert(whatsappSettings).values({ id: existingSetting?.id ?? crypto.randomUUID(), tenantId: access.context.tenantId, mode: "basic", basicPhoneNumber: normalizedPhone, createdAt: existingSetting?.createdAt ?? now, updatedAt: now }).onConflictDoUpdate({ target: whatsappSettings.tenantId, set: { mode: "basic", basicPhoneNumber: normalizedPhone, updatedAt: now } }).run();
      await access.context.db.update(whatsappConnections).set({ isActive: false, updatedAt: now }).where(eq(whatsappConnections.tenantId, access.context.tenantId)).run();
      await access.context.db.update(whatsappNotifications).set({ status: "cancelled", leaseUntil: null, lastError: "الإرسال التلقائي متوقف في الوضع البسيط؛ استخدم رابط wa.me اليدوي", updatedAt: now }).where(and(eq(whatsappNotifications.tenantId, access.context.tenantId), inArray(whatsappNotifications.status, ["queued", "processing"]))).run();
      await writeAudit(access.context, request, "whatsapp.mode_changed", "whatsapp_settings", existingSetting?.id ?? access.context.tenantId, { mode: "basic", phoneConfigured: true });
      return Response.json({ saved: true, mode: "basic", basicPhoneNumber: `+${normalizedPhone}` });
    }

    if (!existingConnection && !input.accessToken) throw new ApiError("أدخل access token لربط WhatsApp أول مرة");
    const encrypted = input.accessToken ? await encryptWhatsAppToken(input.accessToken, whatsappEncryptionKey(access.context.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? access.context.env.WHATSAPP_ENCRYPTION_KEY)) : null;
    const id = existingConnection?.id ?? crypto.randomUUID();
    const values = { id, tenantId: access.context.tenantId, phoneNumberId: input.phoneNumberId, businessAccountId: input.businessAccountId ?? null, webhookVerifyToken: input.webhookVerifyToken ?? existingConnection?.webhookVerifyToken ?? null, webhookUrl: input.webhookUrl ?? existingConnection?.webhookUrl ?? null, defaultTemplateName: input.defaultTemplateName ?? existingConnection?.defaultTemplateName ?? input.confirmationTemplate, accessTokenCiphertext: encrypted?.ciphertext ?? existingConnection!.accessTokenCiphertext, accessTokenNonce: encrypted?.nonce ?? existingConnection!.accessTokenNonce, confirmationTemplate: input.confirmationTemplate, reminderTemplate: input.reminderTemplate, reminderThreeHourTemplate: input.reminderThreeHourTemplate, reviewTemplate: input.reviewTemplate, languageCode: input.languageCode, isActive: true, createdAt: existingConnection?.createdAt ?? now, updatedAt: now };
    const [connection] = await access.context.db.insert(whatsappConnections).values(values).onConflictDoUpdate({ target: whatsappConnections.tenantId, set: { phoneNumberId: values.phoneNumberId, businessAccountId: values.businessAccountId, webhookVerifyToken: values.webhookVerifyToken, webhookUrl: values.webhookUrl, defaultTemplateName: values.defaultTemplateName, accessTokenCiphertext: values.accessTokenCiphertext, accessTokenNonce: values.accessTokenNonce, confirmationTemplate: values.confirmationTemplate, reminderTemplate: values.reminderTemplate, reminderThreeHourTemplate: values.reminderThreeHourTemplate, reviewTemplate: values.reviewTemplate, languageCode: values.languageCode, isActive: true, updatedAt: now } }).returning();
    await access.context.db.insert(whatsappSettings).values({ id: existingSetting?.id ?? crypto.randomUUID(), tenantId: access.context.tenantId, mode: "advanced", basicPhoneNumber: existingSetting?.basicPhoneNumber ?? null, createdAt: existingSetting?.createdAt ?? now, updatedAt: now }).onConflictDoUpdate({ target: whatsappSettings.tenantId, set: { mode: "advanced", updatedAt: now } }).run();
    await writeAudit(access.context, request, "whatsapp.connection_saved", "whatsapp_connection", connection?.id ?? id, { phoneNumberId: input.phoneNumberId, tokenRotated: Boolean(input.accessToken), mode: "advanced" });
    return Response.json({ saved: true, mode: "advanced", phoneNumberId: connection?.phoneNumberId, tokenConfigured: Boolean(connection?.accessTokenCiphertext), isActive: connection?.isActive });
  } catch (error) {
    if (String(error).includes("whatsapp_connections_phone_id_uq")) return Response.json({ error: "رقم WhatsApp هذا مرتبط بالفعل بمساحة عمل أخرى" }, { status: 409 });
    return errorResponse(error);
  }
}

async function jsonRoute(handler: () => Promise<Response>, fallback: string): Promise<Response> {
  try {
    const response = await handler();
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return Response.json({ error: fallback }, { status: response.status || 500, headers: { "Cache-Control": "no-store" } });
    return response;
  } catch (error) {
    return errorResponse(error, fallback);
  }
}
export function GET(request: Request): Promise<Response> { return jsonRoute(() => getWhatsAppSettings(request), "تعذر تحميل إعدادات WhatsApp"); }
export function PUT(request: Request): Promise<Response> { return jsonRoute(() => putWhatsAppSettings(request), "تعذر حفظ إعدادات WhatsApp"); }
