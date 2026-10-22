import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { addBillingCycle, type BillingCycle } from "@/lib/platform/billing";
import { reviewAddonRequest } from "@/lib/platform/addon-review";
import { answerTelegramCallback, isAllowedBillingAdmin } from "@/lib/platform/telegram";
import { platformBillingRequests, telegramWebhookEvents, tenants, users } from "@/lib/db/schema";
import { safeEqual } from "@/lib/whatsapp/security";

export const runtime = "edge";
const callbackSchema = z.object({
  id: z.string().min(1).max(200),
  from: z.object({ id: z.number().int().positive() }).passthrough(),
  message: z.object({ message_id: z.number().int(), chat: z.object({ id: z.union([z.number().int(), z.string()]), type: z.string().max(32) }).passthrough() }).passthrough(),
  data: z.string().max(64).optional(),
}).passthrough();
const telegramUpdateSchema = z.object({ update_id: z.number().int().nonnegative().safe(), callback_query: callbackSchema.optional() }).passthrough();

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim() || env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32 || !telegramChatId || !env.TELEGRAM_ADMIN_ACCOUNT_ID) return Response.json({ error: "Telegram billing webhook is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_WEBHOOK_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 128_000) return Response.json({ error: "Update is too large" }, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 128_000) return Response.json({ error: "Update is too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = telegramUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Unsupported Telegram update" }, { status: 400 });
  const { update_id: updateId, callback_query: callback } = parsed.data;
  if (!callback) {
    await recordWebhookEvent(String(updateId), "ignored_non_callback");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const allowed = isAllowedBillingAdmin({ chatId: String(callback.message.chat.id), chatType: callback.message.chat.type, senderId: String(callback.from.id) }, telegramChatId, env.TELEGRAM_ADMIN_USER_ID);
  if (!allowed) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const prior = await getDb().select({ id: telegramWebhookEvents.id }).from(telegramWebhookEvents).where(eq(telegramWebhookEvents.updateId, String(updateId))).limit(1);
  if (prior.length) {
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تم استلام هذا التحديث مسبقاً").catch(() => undefined);
    return Response.json({ ok: true, duplicate: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const match = /^(approve|reject|addon_approve|addon_reject):([0-9a-f-]{36})$/i.exec(callback.data ?? "");
  if (!match) {
    await recordWebhookEvent(String(updateId), "unsupported_callback");
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "هذا الزر غير صالح").catch(() => undefined);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const [, action, requestId] = match;
  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, env.TELEGRAM_ADMIN_ACCOUNT_ID), eq(users.role, "super_admin"), isNull(users.tenantId), eq(users.isActive, true))).limit(1);
  if (!owner) return Response.json({ error: "Telegram owner mapping is invalid" }, { status: 503 });
  if (action!.toLowerCase().startsWith("addon_")) {
    const decision = action!.toLowerCase().replace("addon_", "") as "approve" | "reject";
    const result = await reviewAddonRequest(env.DB, requestId!, owner.id, decision);
    if (result.outcome === "not_found") {
      await recordWebhookEvent(String(updateId), "addon_request_not_found");
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "طلب الإضافة غير موجود").catch(() => undefined);
      return Response.json({ ok: true, notFound: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (result.outcome === "already_processed") {
      await recordWebhookEvent(String(updateId), `addon_${decision}_already_processed`);
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تمت معالجة الطلب أو لم يعد قيد المراجعة").catch(() => undefined);
      return Response.json({ ok: true, alreadyProcessed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (result.outcome === "expired") {
      await recordWebhookEvent(String(updateId), "addon_request_expired");
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "انتهت دورة الاشتراك؛ لم تُفعّل الإضافة").catch(() => undefined);
      return Response.json({ ok: true, decision: "expired" }, { headers: { "Cache-Control": "no-store" } });
    }
    await recordWebhookEvent(String(updateId), `addon_request_${result.outcome}`);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, result.outcome === "approved" ? "تم اعتماد التحويل وتفعيل سعة الإضافة" : "رُفض الإيصال؛ يمكن للمنشأة رفع طلب جديد").catch(() => undefined);
    return Response.json({ ok: true, decision: result.outcome, invoiceNumber: result.invoiceNumber }, { headers: { "Cache-Control": "no-store" } });
  }
  const decision = action!.toLowerCase();
  const [billingRequest] = await db.select().from(platformBillingRequests).where(eq(platformBillingRequests.id, requestId!)).limit(1);
  if (!billingRequest || billingRequest.status !== "pending_review") {
    await recordWebhookEvent(String(updateId), `billing_${decision}_already_processed`);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تمت معالجة الطلب أو لم يعد قيد المراجعة").catch(() => undefined);
    return Response.json({ ok: true, alreadyProcessed: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (decision!.toLowerCase() === "reject") {
    const rejected = await rejectRequest(env.DB, billingRequest.id, owner.id, updateId);
    if (!rejected) {
      await recordWebhookEvent(String(updateId), "billing_rejection_race_lost");
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تمت معالجة الطلب من قبل مسؤول آخر").catch(() => undefined);
      return Response.json({ ok: true, alreadyProcessed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await recordWebhookEvent(String(updateId), "billing_request_rejected");
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "رُفض الإيصال؛ يمكن لصاحب المنشأة رفع إيصال جديد").catch(() => undefined);
    return Response.json({ ok: true, decision: "rejected" }, { headers: { "Cache-Control": "no-store" } });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, billingRequest.tenantId)).limit(1);
  if (!tenant) return Response.json({ error: "Billing tenant not found" }, { status: 500 });
  const now = new Date();
  const extensionStart = [tenant.subscriptionEndsAt, tenant.status === "active_trial" ? tenant.trialEndsAt : null].filter((value): value is Date => Boolean(value && value.getTime() > now.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
  let periodEnd: Date;
  try { periodEnd = addBillingCycle(extensionStart, billingRequest.billingCycleSnapshot as BillingCycle, billingRequest.billingCycleSnapshot === "custom_days" ? billingRequest.durationDaysSnapshot : null); }
  catch { return Response.json({ error: "Billing period snapshot is invalid" }, { status: 500 }); }
  const approvalToken = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const invoiceNumber = `QF-${now.getUTCFullYear()}-${billingRequest.id.slice(0, 8).toUpperCase()}`;
  const metadata = JSON.stringify({ tenantId: billingRequest.tenantId, billingRequestId: billingRequest.id, invoiceId, invoiceNumber, planId: billingRequest.planId, amountMinor: billingRequest.amountMinor, currency: billingRequest.currency, periodEnd: periodEnd.toISOString() });
  const unixNow = Math.floor(now.getTime() / 1000);
  const unixStart = Math.floor(extensionStart.getTime() / 1000);
  const unixEnd = Math.floor(periodEnd.getTime() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE platform_billing_requests SET status = 'approved', reviewed_by = ?, reviewed_at = unixepoch(), approval_token = ?, rejection_reason = NULL, updated_at = unixepoch() WHERE id = ? AND status = 'pending_review'").bind(owner.id, approvalToken, billingRequest.id),
    env.DB.prepare("INSERT INTO platform_invoices (id, tenant_id, request_id, plan_id, invoice_number, plan_name_snapshot, payment_method, amount_minor, currency, period_start, period_end, status, paid_at, created_at) SELECT ?, tenant_id, id, plan_id, ?, plan_name_snapshot, payment_method, amount_minor, currency, ?, ?, 'paid', ?, ? FROM platform_billing_requests WHERE id = ? AND status = 'approved' AND approval_token = ?").bind(invoiceId, invoiceNumber, unixStart, unixEnd, unixNow, unixNow, billingRequest.id, approvalToken),
    env.DB.prepare("UPDATE tenants SET platform_plan_id = ?, subscription_ends_at = ?, status = CASE WHEN status = 'frozen' THEN 'frozen' ELSE 'active' END, frozen_from_status = CASE WHEN status = 'frozen' THEN 'active' ELSE NULL END, updated_at = unixepoch() WHERE id = ? AND EXISTS (SELECT 1 FROM platform_billing_requests WHERE id = ? AND status = 'approved' AND approval_token = ?)").bind(billingRequest.planId, unixEnd, billingRequest.tenantId, billingRequest.id, approvalToken),
    env.DB.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, NULL, ?, 'billing.request_approved', 'platform_billing_request', ?, NULL, NULL, ?, unixepoch() WHERE EXISTS (SELECT 1 FROM platform_billing_requests WHERE id = ? AND status = 'approved' AND approval_token = ?)").bind(crypto.randomUUID(), owner.id, billingRequest.id, metadata, billingRequest.id, approvalToken),
  ]);
  if (!results[0]?.success) return Response.json({ error: "Billing decision could not be saved" }, { status: 500 });
  const changed = Number(results[0].meta?.changes ?? 0) > 0;
  if (!changed) {
    await recordWebhookEvent(String(updateId), "billing_approval_race_lost");
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تمت معالجة الطلب من قبل مسؤول آخر").catch(() => undefined);
    return Response.json({ ok: true, alreadyProcessed: true }, { headers: { "Cache-Control": "no-store" } });
  }
  await recordWebhookEvent(String(updateId), "billing_request_approved");
  await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.id, "تم اعتماد التحويل وتفعيل الاشتراك").catch(() => undefined);
  return Response.json({ ok: true, decision: "approved", invoiceNumber, periodEnd }, { headers: { "Cache-Control": "no-store" } });
}

async function rejectRequest(database: D1Database, requestId: string, ownerId: string, updateId: number): Promise<boolean> {
  const token = crypto.randomUUID();
  const metadata = JSON.stringify({ updateId: String(updateId), decision: "rejected" });
  const results = await database.batch([
    database.prepare("UPDATE platform_billing_requests SET status = 'rejected', rejection_reason = 'تعذر اعتماد الإيصال؛ ارفع صورة واضحة أو تواصل مع الدعم', reviewed_by = ?, reviewed_at = unixepoch(), approval_token = ?, telegram_lease_until = NULL, updated_at = unixepoch() WHERE id = ? AND status = 'pending_review'").bind(ownerId, token, requestId),
    database.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, NULL, ?, 'billing.request_rejected', 'platform_billing_request', ?, NULL, NULL, ?, unixepoch() WHERE EXISTS (SELECT 1 FROM platform_billing_requests WHERE id = ? AND status = 'rejected' AND approval_token = ?)").bind(crypto.randomUUID(), ownerId, requestId, metadata, requestId, token),
  ]);
  if (!results[0]?.success) throw new Error("Billing rejection could not be saved");
  return Number(results[0]?.meta?.changes ?? 0) > 0;
}

async function recordWebhookEvent(updateId: string, eventType: string): Promise<void> {
  await getDb().insert(telegramWebhookEvents).values({ id: crypto.randomUUID(), updateId, eventType, processedAt: new Date(), createdAt: new Date() }).onConflictDoNothing().run();
}
