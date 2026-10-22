import { and, eq } from "drizzle-orm";
import { platformAddonRequests, platformBillingRequests, platformPlans, platformSettings } from "@/lib/db/schema";
import { calculateAddonAmountMinor } from "@/lib/platform/addon-entitlements";
import { isFeatureEnabled } from "@/lib/platform/features";
import { classifyCatalogFeaturesJson } from "@/lib/platform/catalog";
import { dispatchAddonNotifications } from "@/lib/platform/telegram-dispatch";
import { requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const PAYMENT_METHODS = ["vodafone_cash", "instapay"] as const;

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowBillingAccess: true });
  if (!access.ok) return access.response;
  const { db, tenant } = access.context;
  if (!await isFeatureEnabled(db, "subscription_billing", true)) return Response.json({ error: "طلبات الإضافات متوقفة مؤقتاً" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const planId = url.searchParams.get("addonPlanId") ?? "";
  const quantity = Number(url.searchParams.get("quantity"));
  const subscriptionEnd = tenant.subscriptionEndsAt;
  if (tenant.status !== "active" || !subscriptionEnd || subscriptionEnd.getTime() <= Date.now()) return Response.json({ error: "يلزم وجود اشتراك مدفوع نشط لطلب إضافة موارد" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  if (!planId || planId.length > 64 || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) return Response.json({ error: "بيانات الإضافة أو الكمية غير صالحة" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const [plan] = await db.select().from(platformPlans).where(and(eq(platformPlans.id, planId), eq(platformPlans.isActive, true))).limit(1);
  const classification = classifyCatalogFeaturesJson(plan?.featuresJson);
  if (!plan || classification.kind !== "addon") return Response.json({ error: "الإضافة غير متاحة حالياً" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const now = new Date();
    const amountMinor = calculateAddonAmountMinor({ unitPriceMinor: plan.priceMinor, quantity, billingCycle: plan.billingCycle, customDays: plan.customDays, subscriptionEndsAt: subscriptionEnd, now });
    return Response.json({ amountMinor, currency: plan.currency, unitPriceMinor: plan.priceMinor, quantity, subscriptionEndsAt: subscriptionEnd }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر احتساب قيمة الإضافة" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowBillingAccess: true });
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { db, env, tenantId, user, tenant } = access.context;
  if (!await isFeatureEnabled(db, "subscription_billing", true)) return Response.json({ error: "طلبات الإضافات متوقفة مؤقتاً؛ تواصل مع مالك المنصة" }, { status: 503 });
  const now = new Date();
  const subscriptionEnd = tenant.subscriptionEndsAt;
  if (tenant.status !== "active" || !subscriptionEnd || subscriptionEnd.getTime() <= now.getTime()) return Response.json({ error: "يلزم وجود اشتراك مدفوع نشط لطلب إضافة موارد" }, { status: 409 });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_RECEIPT_BYTES + 64 * 1024) return Response.json({ error: "حجم إيصال التحويل يتجاوز 5 ميغابايت" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "تعذر قراءة نموذج رفع الإيصال" }, { status: 400 });
  const planId = form.get("addonPlanId");
  const paymentMethod = form.get("paymentMethod");
  const quantityValue = form.get("quantity");
  const receipt = form.get("receipt");
  const quantity = typeof quantityValue === "string" ? Number(quantityValue) : NaN;
  if (typeof planId !== "string" || planId.length > 64 || typeof paymentMethod !== "string" || !PAYMENT_METHODS.includes(paymentMethod as (typeof PAYMENT_METHODS)[number]) || !(receipt instanceof File) || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
    return Response.json({ error: "اختر إضافة وعدداً صحيحاً وطريقة دفع وارفع صورة الإيصال" }, { status: 400 });
  }
  if (receipt.size < 1 || receipt.size > MAX_RECEIPT_BYTES) return Response.json({ error: "حجم الإيصال يجب ألا يتجاوز 5 ميغابايت" }, { status: 413 });
  const bytes = new Uint8Array(await receipt.arrayBuffer());
  if (!isSupportedImage(receipt.type, bytes)) return Response.json({ error: "الصيغ المقبولة: JPEG أو PNG أو WebP فقط" }, { status: 415 });

  const [plan] = await db.select().from(platformPlans).where(and(eq(platformPlans.id, planId), eq(platformPlans.isActive, true))).limit(1);
  const classification = classifyCatalogFeaturesJson(plan?.featuresJson);
  if (!plan || classification.kind !== "addon") return Response.json({ error: "الإضافة غير متاحة حالياً" }, { status: 404 });
  let amountMinor: number;
  try {
    amountMinor = calculateAddonAmountMinor({ unitPriceMinor: plan.priceMinor, quantity, billingCycle: plan.billingCycle, customDays: plan.customDays, subscriptionEndsAt: subscriptionEnd, now });
  } catch {
    return Response.json({ error: "تعذر احتساب قيمة الإضافة أو انتهت دورة الاشتراك" }, { status: 409 });
  }

  const settings = await db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings);
  const settingsMap = Object.fromEntries(settings.map(({ key, value }) => [key, value]));
  if (paymentMethod === "vodafone_cash" && !settingsMap["billing.vodafone_cash_number"]) return Response.json({ error: "بيانات فودافون كاش غير مهيأة؛ تواصل مع الدعم" }, { status: 503 });
  if (paymentMethod === "instapay" && !isHttpsUrl(settingsMap["billing.instapay_qr_url"] ?? "")) return Response.json({ error: "رمز InstaPay غير مهيأ؛ اختر طريقة أخرى أو تواصل مع الدعم" }, { status: 503 });
  if (!env.FILES) return Response.json({ error: "خدمة حفظ الإيصالات غير مهيأة" }, { status: 503 });

  const [pendingSubscription] = await db.select({ id: platformBillingRequests.id }).from(platformBillingRequests).where(and(eq(platformBillingRequests.tenantId, tenantId), eq(platformBillingRequests.status, "pending_review"))).limit(1);
  const [pendingAddon] = await db.select({ id: platformAddonRequests.id }).from(platformAddonRequests).where(and(eq(platformAddonRequests.tenantId, tenantId), eq(platformAddonRequests.status, "pending_review"))).limit(1);
  if (pendingSubscription || pendingAddon) return Response.json({ error: "لديك طلب تحويل قيد المراجعة بالفعل" }, { status: 409 });

  const requestId = crypto.randomUUID();
  const extension = receipt.type === "image/png" ? "png" : receipt.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `platform-addon-receipts/${tenantId}/${requestId}.${extension}`;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const receiptSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: receipt.type, cacheControl: "private, no-store" }, customMetadata: { tenantId, requestId } });
    await db.insert(platformAddonRequests).values({
      id: requestId, tenantId, requestedBy: user.id, planId: plan.id, resourceType: classification.resourceType,
      addonNameSnapshot: plan.nameAr, billingCycleSnapshot: plan.billingCycle, customDaysSnapshot: plan.customDays,
      quantity, unitPriceMinor: plan.priceMinor, amountMinor, currency: plan.currency,
      subscriptionEndSnapshot: subscriptionEnd, status: "pending_review", paymentMethod: paymentMethod as (typeof PAYMENT_METHODS)[number],
      receiptObjectKey: objectKey, receiptContentType: receipt.type, receiptSize: receipt.size, receiptSha256,
      createdAt: now, updatedAt: now,
    }).run();
  } catch {
    await env.FILES.delete(objectKey).catch(() => undefined);
    return Response.json({ error: "تعذر تسجيل الطلب؛ قد يوجد طلب آخر قيد المراجعة" }, { status: 409 });
  }
  await writeAudit(access.context, request, "billing.addon_request_submitted", "platform_addon_request", requestId, { resourceType: classification.resourceType, quantity, amountMinor, currency: plan.currency, paymentMethod });
  const dispatch = await dispatchAddonNotifications(1, requestId).catch(() => ({ claimed: 0, sent: 0, deferred: 1 }));
  return Response.json({ requestId, status: "pending_review", amountMinor, currency: plan.currency, telegramNotification: dispatch.sent ? "sent" : "queued_for_retry" }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function isSupportedImage(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  if (type === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
