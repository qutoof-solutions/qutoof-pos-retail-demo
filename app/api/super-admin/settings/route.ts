import { z } from "zod";
import { platformSettings } from "@/lib/db/schema";
import { safeTrialDays } from "@/lib/platform/billing";
import { readPlanDiscountSettings } from "@/lib/platform/discounts";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const settingsPatchSchema = z.object({
  trialDays: z.number().int().min(1).max(180).optional(),
  vodafoneCashNumber: z.string().trim().max(20).regex(/^(?:\+?[1-9][0-9]{7,14})?$/).optional(),
  instapayQrUrl: z.string().trim().max(2048).optional(),
  monthlyDiscountPercent: z.number().min(0).max(100).optional(),
  annualDiscountMode: z.enum(["free_months", "percent"]).optional(),
  annualFreeMonths: z.number().int().min(0).max(11).optional(),
  annualDiscountPercent: z.number().min(0).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "أدخل إعداداً واحداً على الأقل");

function response(values: Record<string, string>) {
  return Response.json({ trialDays: safeTrialDays(values.trial_days), graceDays: 3, vodafoneCashNumber: values["billing.vodafone_cash_number"] ?? "", instapayQrUrl: values["billing.instapay_qr_url"] ?? "", currency: "EGP", ...readPlanDiscountSettings(values) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const rows = await access.context.db.select().from(platformSettings);
  return response(Object.fromEntries(rows.map(({ key, value }) => [key, value])));
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const parsed = settingsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "الإعدادات غير صالحة" }, { status: 400 });
  const input = parsed.data;
  if (input.instapayQrUrl) {
    try { const url = new URL(input.instapayQrUrl); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
    catch { return Response.json({ error: "رابط QR لـ InstaPay يجب أن يستخدم HTTPS" }, { status: 400 }); }
  }
  const settings = [
    ...(input.trialDays !== undefined ? [{ key: "trial_days", value: String(input.trialDays) }] : []),
    ...(input.vodafoneCashNumber !== undefined ? [{ key: "billing.vodafone_cash_number", value: input.vodafoneCashNumber }] : []),
    ...(input.instapayQrUrl !== undefined ? [{ key: "billing.instapay_qr_url", value: input.instapayQrUrl }] : []),
    ...(input.monthlyDiscountPercent !== undefined ? [{ key: "pricing.monthly_discount_percent", value: String(input.monthlyDiscountPercent) }] : []),
    ...(input.annualDiscountMode !== undefined ? [{ key: "pricing.annual_discount_mode", value: input.annualDiscountMode }] : []),
    ...(input.annualFreeMonths !== undefined ? [{ key: "pricing.annual_free_months", value: String(input.annualFreeMonths) }] : []),
    ...(input.annualDiscountPercent !== undefined ? [{ key: "pricing.annual_discount_percent", value: String(input.annualDiscountPercent) }] : []),
  ];
  const now = new Date();
  for (const setting of settings) await access.context.db.insert(platformSettings).values({ ...setting, updatedBy: access.context.user.id, updatedAt: now }).onConflictDoUpdate({ target: platformSettings.key, set: { value: setting.value, updatedBy: access.context.user.id, updatedAt: now } }).run();
  await writePlatformAudit(access.context, request, "platform.settings_updated", "platform_settings", null, { keys: settings.map((setting) => setting.key), ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}) });
  const rows = await access.context.db.select().from(platformSettings);
  return response(Object.fromEntries(rows.map(({ key, value }) => [key, value])));
}
