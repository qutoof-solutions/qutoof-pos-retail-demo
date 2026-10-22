import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { platformPlans } from "@/lib/db/schema";
import { classifyCatalogFeatures, type ResourceAddonType } from "@/lib/platform/catalog";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";
import { ensurePlatformPlanDescriptionColumns } from "@/lib/platform/plan-schema";

export const runtime = "edge";
const changesSchema = z.object({
  nameAr: z.string().trim().min(2).max(80).optional(),
  nameEn: z.string().trim().min(2).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9 &'()._-]{1,119}$/).optional(),
  descriptionAr: z.string().trim().max(2000).optional(),
  descriptionEn: z.string().trim().max(2000).optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/).optional(),
  billingCycle: z.enum(["monthly", "quarterly", "semi_annual", "annual", "custom_days"]).optional(),
  customDays: z.number().int().min(1).max(3650).nullable().optional(),
  priceMinor: z.number().int().min(1).max(10_000_000_000).optional(),
  maxUsers: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxBranches: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxWarehouses: z.number().int().min(0).max(1_000_000).nullable().optional(),
  features: z.object({}).catchall(z.boolean())
    .refine((features) => Object.keys(features).length <= 64 && Object.keys(features).every((key) => /^[a-z0-9_]{1,48}$/.test(key)), "مفاتيح الميزات يجب أن تكون رموزاً قصيرة بالإنجليزية")
    .refine((features) => classifyCatalogFeatures(features).kind !== "invalid_addon", "اختر نوع إضافة مورد واحدًا فقط")
    .optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  await ensurePlatformPlanDescriptionColumns();
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { planId } = await context.params;
  const parsed = changesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !Object.keys(parsed.data ?? {}).length) return Response.json({ error: "بيانات التحديث غير صالحة" }, { status: 400 });
  const { db } = access.context;
  const [existing] = await db.select().from(platformPlans).where(eq(platformPlans.id, planId)).limit(1);
  if (!existing) return Response.json({ error: "الباقة غير موجودة" }, { status: 404 });
  const update = parsed.data;
  let existingFeatures: Record<string, boolean> = {};
  try {
    const raw: unknown = JSON.parse(existing.featuresJson);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) existingFeatures = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { existingFeatures = {}; }
  const nextFeatures = update.features ?? existingFeatures;
  const existingKind = classifyCatalogFeatures(existingFeatures).kind;
  const nextKind = classifyCatalogFeatures(nextFeatures).kind;
  if (nextKind === "invalid_addon") return Response.json({ error: "اختر إضافة مورد واحدة فقط" }, { status: 400 });
  if (nextKind === "plan" && existingKind === "addon" && [update.maxUsers, update.maxBranches, update.maxWarehouses].some((limit) => limit === undefined)) {
    return Response.json({ error: "أدخل حدود الاستخدام أو اختر غير محدود لكل مورد" }, { status: 400 });
  }
  const nextCycle = update.billingCycle ?? existing.billingCycle;
  const nextCustomDays = update.customDays !== undefined ? update.customDays : existing.customDays;
  if ((nextCycle === "custom_days" && !nextCustomDays) || (nextCycle !== "custom_days" && nextCustomDays != null)) return Response.json({ error: "تحقق من مدة الدورة؛ الدورة المخصصة فقط تتطلب عدد أيام" }, { status: 400 });
  if (update.code) {
    const [duplicate] = await db.select({ id: platformPlans.id }).from(platformPlans).where(and(eq(platformPlans.code, update.code), ne(platformPlans.id, planId))).limit(1);
    if (duplicate) return Response.json({ error: "رمز الباقة الداخلي مستخدم بالفعل" }, { status: 409 });
  }
  const values = {
    ...(update.nameAr ? { nameAr: update.nameAr } : {}),
    ...(update.nameEn ? { nameEn: update.nameEn } : {}),
    ...(update.descriptionAr !== undefined ? { descriptionAr: update.descriptionAr } : {}),
    ...(update.descriptionEn !== undefined ? { descriptionEn: update.descriptionEn } : {}),
    ...(update.code ? { code: update.code } : {}),
    ...(update.billingCycle ? { billingCycle: update.billingCycle } : {}),
    ...(update.customDays !== undefined ? { customDays: update.customDays } : {}),
    ...(update.priceMinor !== undefined ? { priceMinor: update.priceMinor } : {}),
    ...(update.features ? { featuresJson: JSON.stringify(update.features) } : {}),
    ...(nextKind === "addon" ? { maxUsers: null, maxBranches: null, maxWarehouses: null } : {}),
    ...(nextKind === "plan" && update.maxUsers !== undefined ? { maxUsers: update.maxUsers } : {}),
    ...(nextKind === "plan" && update.maxBranches !== undefined ? { maxBranches: update.maxBranches } : {}),
    ...(nextKind === "plan" && update.maxWarehouses !== undefined ? { maxWarehouses: update.maxWarehouses } : {}),
    ...(update.isActive !== undefined ? { isActive: update.isActive } : {}),
    updatedAt: new Date(),
  };
  try {
    await db.update(platformPlans).set(values).where(eq(platformPlans.id, planId)).run();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return Response.json({ errorCode: "conflict", error: "يوجد عنصر كتالوج بنفس الرمز أو الاسم الإنجليزي" }, { status: 409 });
    console.error("[platform-plans] update failed", cause);
    return Response.json({ errorCode: "databaseError", error: "تعذر حفظ الباقة. تحقق من بنية قاعدة البيانات ثم أعد المحاولة." }, { status: 500 });
  }
  await writePlatformAudit(access.context, request, "platform_plan.updated", "platform_plan", planId, { fields: Object.keys(update), isActive: update.isActive ?? existing.isActive }).catch((cause) => console.error("[platform-plans] audit failed after update", cause));
  const [plan] = await db.select().from(platformPlans).where(eq(platformPlans.id, planId)).limit(1);
  return Response.json({ plan: serializePlan(plan ?? { ...existing, ...values }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  await ensurePlatformPlanDescriptionColumns();
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const { planId } = await context.params;
  const [plan] = await access.context.db.select({ id: platformPlans.id, nameEn: platformPlans.nameEn, isActive: platformPlans.isActive }).from(platformPlans).where(eq(platformPlans.id, planId)).limit(1);
  if (!plan) return Response.json({ error: "الباقة غير موجودة" }, { status: 404 });
  if (plan.isActive) {
    await access.context.db.update(platformPlans).set({ isActive: false, updatedAt: new Date() }).where(eq(platformPlans.id, planId)).run();
    await writePlatformAudit(access.context, request, "platform_plan.deactivated", "platform_plan", planId, { nameEn: plan.nameEn });
  }
  return Response.json({ id: planId, isActive: false }, { headers: { "Cache-Control": "no-store" } });
}

type SerializedPlan = typeof platformPlans.$inferSelect & {
  features: Record<string, boolean>;
  catalogKind: "plan" | "addon" | "invalid_addon";
  addonResourceType: ResourceAddonType | null;
};

function serializePlan(plan: typeof platformPlans.$inferSelect): SerializedPlan {
  let features: Record<string, boolean> = {};
  try { const value: unknown = JSON.parse(plan.featuresJson); if (value && typeof value === "object" && !Array.isArray(value)) features = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")); } catch { features = {}; }
  const classification = classifyCatalogFeatures(features);
  return {
    ...plan,
    features,
    catalogKind: classification.kind === "invalid_addon" ? "invalid_addon" : classification.kind,
    addonResourceType: classification.kind === "addon" ? classification.resourceType : null,
  };
}
