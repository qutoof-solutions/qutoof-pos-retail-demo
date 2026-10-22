import { and, eq } from "drizzle-orm";
import { platformAddonRequests, platformBillingRequests, platformPlans, platformSettings } from "@/lib/db/schema";
import { classifyCatalogFeaturesJson } from "@/lib/platform/catalog";
import { addBillingCycle, type BillingCycle } from "@/lib/platform/billing";
import { dispatchBillingNotifications } from "@/lib/platform/telegram-dispatch";
import { isFeatureEnabled } from "@/lib/platform/features";
import { discountedPlanPriceMinor, readPlanDiscountSettings } from "@/lib/platform/discounts";
import { requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const PAYMENT_METHODS = ["vodafone_cash", "instapay"] as const;

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowBillingAccess: true });
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { db, env, tenantId, user } = access.context;
  if (!await isFeatureEnabled(db, "subscription_billing", true)) return Response.json({ error: "الاشتراكات معطلة مؤقتاً؛ تواصل مع مالك المنصة" }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_RECEIPT_BYTES + 64 * 1024) return Response.json({ error: "حجم إيصال التحويل يتجاوز 5 ميغابايت" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "تعذر قراءة نموذج رفع الإيصال" }, { status: 400 });
  const planId = form.get("planId");
  const paymentMethod = form.get("paymentMethod");
  const receipt = form.get("receipt");
  if (typeof planId !== "string" || planId.length > 64 || typeof paymentMethod !== "string" || !PAYMENT_METHODS.includes(paymentMethod as (typeof PAYMENT_METHODS)[number]) || !(receipt instanceof File)) return Response.json({ error: "اختر باقة وطريقة دفع وارفع صورة الإيصال" }, { status: 400 });
  if (receipt.size < 1 || receipt.size > MAX_RECEIPT_BYTES) return Response.json({ error: "حجم الإيصال يجب ألا يتجاوز 5 ميغابايت" }, { status: 413 });
  const bytes = new Uint8Array(await receipt.arrayBuffer());
  if (!isSupportedImage(receipt.type, bytes)) return Response.json({ error: "الصيغ المقبولة: JPEG أو PNG أو WebP فقط" }, { status: 415 });
  const [plan] = await db.select().from(platformPlans).where(and(eq(platformPlans.id, planId), eq(platformPlans.isActive, true))).limit(1);
  if (!plan || classifyCatalogFeaturesJson(plan.featuresJson).kind !== "plan") return Response.json({ error: "الباقة غير متاحة حالياً" }, { status: 404 });
  const settings = await db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings);
  const settingsMap = Object.fromEntries(settings.map(({ key, value }) => [key, value]));
  const discountSettings = readPlanDiscountSettings(settingsMap);
  if (paymentMethod === "vodafone_cash" && !settingsMap["billing.vodafone_cash_number"]) return Response.json({ error: "بيانات فودافون كاش غير مهيأة؛ تواصل مع الدعم" }, { status: 503 });
  if (paymentMethod === "instapay" && !isHttpsUrl(settingsMap["billing.instapay_qr_url"] ?? "")) return Response.json({ error: "رمز InstaPay غير مهيأ؛ اختر طريقة أخرى أو تواصل مع الدعم" }, { status: 503 });
  if (!env.FILES) return Response.json({ error: "خدمة حفظ الإيصالات غير مهيأة" }, { status: 503 });
  const [existingSubscription, existingAddon] = await Promise.all([
    db.select({ id: platformBillingRequests.id }).from(platformBillingRequests).where(and(eq(platformBillingRequests.tenantId, tenantId), eq(platformBillingRequests.status, "pending_review"))).limit(1),
    db.select({ id: platformAddonRequests.id }).from(platformAddonRequests).where(and(eq(platformAddonRequests.tenantId, tenantId), eq(platformAddonRequests.status, "pending_review"))).limit(1),
  ]);
  if (existingSubscription.length || existingAddon.length) return Response.json({ error: "لديك طلب تحويل قيد المراجعة بالفعل" }, { status: 409 });
  const cycle = plan.billingCycle as BillingCycle;
  const monthlyCode = plan.code?.replace(/_annual$/, "_monthly");
  const [monthlyPlan] = cycle === "annual" && monthlyCode ? await db.select({ priceMinor: platformPlans.priceMinor }).from(platformPlans).where(and(eq(platformPlans.isActive, true), eq(platformPlans.billingCycle, "monthly"), eq(platformPlans.code, monthlyCode))).limit(1) : [];
  const amountMinor = discountedPlanPriceMinor({ priceMinor: plan.priceMinor, billingCycle: cycle, monthlyPriceMinor: monthlyPlan?.priceMinor, settings: discountSettings });
  let durationDays: number;
  try {
    const end = addBillingCycle(new Date(Date.UTC(2026, 0, 1)), cycle, plan.customDays);
    durationDays = Math.round((end.getTime() - Date.UTC(2026, 0, 1)) / 86_400_000);
  } catch {
    return Response.json({ error: "إعداد مدة الباقة غير صالح؛ تواصل مع مالك المنصة" }, { status: 409 });
  }
  const requestId = crypto.randomUUID();
  const extension = receipt.type === "image/png" ? "png" : receipt.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `platform-receipts/${tenantId}/${requestId}.${extension}`;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const receiptSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date();
  try {
    await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: receipt.type, cacheControl: "private, no-store" }, customMetadata: { tenantId, requestId } });
    await db.insert(platformBillingRequests).values({
      id: requestId, tenantId, requestedBy: user.id, planId: plan.id, planNameSnapshot: plan.nameAr,
      billingCycleSnapshot: plan.billingCycle, durationDaysSnapshot: durationDays, amountMinor,
      currency: plan.currency, paymentMethod: paymentMethod as (typeof PAYMENT_METHODS)[number], status: "pending_review",
      receiptObjectKey: objectKey, receiptContentType: receipt.type, receiptSize: receipt.size, receiptSha256,
      createdAt: now, updatedAt: now,
    }).run();
  } catch {
    await env.FILES.delete(objectKey).catch(() => undefined);
    return Response.json({ error: "تعذر تسجيل الطلب؛ قد يوجد طلب آخر قيد المراجعة" }, { status: 409 });
  }
  await writeAudit(access.context, request, "billing.request_submitted", "platform_billing_request", requestId, { planId: plan.id, amountMinor, currency: plan.currency, paymentMethod });
  const dispatch = await dispatchBillingNotifications(1, requestId).catch(() => ({ claimed: 0, sent: 0, deferred: 1 }));
  return Response.json({ requestId, status: "pending_review", telegramNotification: dispatch.sent ? "sent" : "queued_for_retry" }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
