import { safeEqual } from "@/lib/whatsapp/security";
import { PRODUCT_NAME } from "@/lib/brand";

export interface TelegramBillingMessage {
  requestId: string;
  tenantName: string;
  tenantSlug: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  planName: string;
  cycleLabel: string;
  paymentMethodLabel: string;
  amountMinor: number;
  currency: string;
  receipt: Uint8Array;
  receiptContentType: string;
  createdAt: Date;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type TelegramEnvironment = { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; TELEGRAM_ADMIN_CHAT_ID?: string };

export function getTelegramChatId(env: TelegramEnvironment): string | undefined {
  return env.TELEGRAM_CHAT_ID?.trim() || env.TELEGRAM_ADMIN_CHAT_ID?.trim() || undefined;
}

export async function sendSupportTicketToOwner(env: TelegramEnvironment, input: { ticketId: string; fullName: string; phone: string; activityType: string; preferredAt: Date | null; details: string; language: string }): Promise<string> {
  const chatId = getTelegramChatId(env);
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) throw new Error("Telegram support notifications are not configured");
  const text = [
    `${PRODUCT_NAME} · تذكرة دعم جديدة`,
    `الاسم: <b>${escapeHtml(input.fullName)}</b>`,
    `التواصل: <code>${escapeHtml(input.phone)}</code>`,
    `النشاط: ${escapeHtml(input.activityType)}`,
    `الموعد المفضل: ${escapeHtml(input.preferredAt?.toISOString() ?? "غير محدد")}`,
    `اللغة: ${escapeHtml(input.language)}`,
    `التفاصيل: ${escapeHtml(input.details)}`,
    `رقم التذكرة: <code>${escapeHtml(input.ticketId)}</code>`,
  ].join("\n");
  let response: Response;
  try { response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), parse_mode: "HTML" }), redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("تعذر الاتصال بـ Telegram لإرسال إشعار الدعم"); }
  if (!response.ok) throw new Error(`Telegram API returned HTTP ${response.status}`);
  const result = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
  if (!result?.ok || !result.result?.message_id) throw new Error("Telegram API rejected the support notification");
  return String(result.result.message_id);
}

export async function sendBillingReceiptToOwner(env: TelegramEnvironment, input: TelegramBillingMessage): Promise<string> {
  const chatId = getTelegramChatId(env);
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) throw new Error("Telegram billing notifications are not configured");
  if (input.requestId.length > 50) throw new Error("Billing request id is too long for a Telegram callback");
  const caption = [
    `${PRODUCT_NAME} · طلب اشتراك جديد`,
    `المنشأة: <b>${escapeHtml(input.tenantName)}</b> (${escapeHtml(input.tenantSlug)})`,
    `مقدم الطلب: <b>${escapeHtml(input.requesterName)}</b>`,
    `البريد: <code>${escapeHtml(input.requesterEmail)}</code>`,
    ...(input.requesterPhone?.trim() ? [`الهاتف: <code>${escapeHtml(input.requesterPhone)}</code>`] : []),
    `الباقة: <b>${escapeHtml(input.planName)}</b> · ${escapeHtml(input.cycleLabel)}`,
    `طريقة التحويل: ${escapeHtml(input.paymentMethodLabel)}`,
    `القيمة: <b>${new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.amountMinor / 100)} ${escapeHtml(input.currency)}</b>`,
    `وقت الطلب: ${escapeHtml(input.createdAt.toISOString())}`,
    `رقم الطلب: <code>${escapeHtml(input.requestId)}</code>`,
  ].join("\n");
  const form = new FormData();
  form.set("chat_id", chatId);
  const photoBytes = new Uint8Array(input.receipt.byteLength);
  photoBytes.set(input.receipt);
  form.set("photo", new Blob([photoBytes.buffer], { type: input.receiptContentType }), `receipt-${input.requestId}.${input.receiptContentType === "image/png" ? "png" : input.receiptContentType === "image/webp" ? "webp" : "jpg"}`);
  form.set("caption", caption.slice(0, 1000));
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "تأكيد وتفعيل الاشتراك ✅", callback_data: `approve:${input.requestId}` }, { text: "رفض الإيصال ❌", callback_data: `reject:${input.requestId}` }]] }));
  let response: Response;
  try { response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("تعذر الاتصال بـ Telegram Bot API"); }
  if (!response.ok) throw new Error(`Telegram API returned HTTP ${response.status}`);
  const result = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
  if (!result?.ok || !result.result?.message_id) throw new Error("Telegram API rejected the billing notification");
  return String(result.result.message_id);
}

export interface TelegramAddonBillingMessage {
  requestId: string;
  tenantName: string;
  tenantSlug: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  addonName: string;
  quantity: number;
  paymentMethodLabel: string;
  amountMinor: number;
  currency: string;
  subscriptionEndsAt: Date;
  receipt: Uint8Array;
  receiptContentType: string;
  createdAt: Date;
}

export async function sendAddonReceiptToOwner(env: TelegramEnvironment, input: TelegramAddonBillingMessage): Promise<string> {
  const chatId = getTelegramChatId(env);
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) throw new Error("Telegram billing notifications are not configured");
  if (input.requestId.length > 50) throw new Error("Addon request id is too long for a Telegram callback");
  const amount = new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.amountMinor / 100);
  const caption = [
    `${PRODUCT_NAME} · طلب إضافة موارد جديد`,
    `المنشأة: <b>${escapeHtml(input.tenantName)}</b> (${escapeHtml(input.tenantSlug)})`,
    `مقدم الطلب: <b>${escapeHtml(input.requesterName)}</b>`,
    `البريد: <code>${escapeHtml(input.requesterEmail)}</code>`,
    ...(input.requesterPhone?.trim() ? [`الهاتف: <code>${escapeHtml(input.requesterPhone)}</code>`] : []),
    `الإضافة: <b>${escapeHtml(input.addonName)}</b> · العدد: ${input.quantity}`,
    `طريقة التحويل: ${escapeHtml(input.paymentMethodLabel)}`,
    `القيمة المحسوبة حتى نهاية الاشتراك: <b>${amount} ${escapeHtml(input.currency)}</b>`,
    `تنتهي السعة: ${escapeHtml(input.subscriptionEndsAt.toISOString())}`,
    `وقت الطلب: ${escapeHtml(input.createdAt.toISOString())}`,
    `رقم الطلب: <code>${escapeHtml(input.requestId)}</code>`,
  ].join("\n");
  const form = new FormData();
  form.set("chat_id", chatId);
  const photoBytes = new Uint8Array(input.receipt.byteLength);
  photoBytes.set(input.receipt);
  form.set("photo", new Blob([photoBytes.buffer], { type: input.receiptContentType }), `addon-receipt-${input.requestId}.${input.receiptContentType === "image/png" ? "png" : input.receiptContentType === "image/webp" ? "webp" : "jpg"}`);
  form.set("caption", caption.slice(0, 1000));
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "اعتماد الإضافة وتفعيل السعة ✅", callback_data: `addon_approve:${input.requestId}` }, { text: "رفض الإيصال ❌", callback_data: `addon_reject:${input.requestId}` }]] }));
  let response: Response;
  try { response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("تعذر الاتصال بـ Telegram Bot API"); }
  if (!response.ok) throw new Error(`Telegram API returned HTTP ${response.status}`);
  const result = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
  if (!result?.ok || !result.result?.message_id) throw new Error("Telegram API rejected the addon notification");
  return String(result.result.message_id);
}

export async function answerTelegramCallback(token: string, callbackQueryId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text.slice(0, 180), show_alert: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Telegram callback acknowledgement failed (${response.status})`);
}

export function isAllowedBillingAdmin(input: { chatId: string; chatType?: string; senderId: string }, configuredChatId: string, configuredUserId?: string): boolean {
  if (!safeEqual(input.chatId, configuredChatId)) return false;
  if (configuredUserId) return safeEqual(input.senderId, configuredUserId);
  return input.chatType === "private" && safeEqual(input.senderId, configuredChatId);
}
