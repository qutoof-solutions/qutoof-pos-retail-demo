import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { platformPlans } from "@/lib/db/schema";
import { classifyCatalogFeatures } from "@/lib/platform/catalog";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";
import { defaultCatalogCode } from "@/lib/platform/catalog-identity";
import { ensurePlatformPlanDescriptionColumns } from "@/lib/platform/plan-schema";

export const runtime = "edge";
const cycleSchema = z.enum(["monthly", "quarterly", "semi_annual", "annual", "custom_days"]);
const featuresSchema = z.object({}).catchall(z.boolean())
  .refine((features) => Object.keys(features).length <= 64 && Object.keys(features).every((key) => /^[a-z0-9_]{1,48}$/.test(key)), "مفاتيح الميزات يجب أن تكون رموزاً قصيرة بالإنجليزية")
  .refine((features) => classifyCatalogFeatures(features).kind !== "invalid_addon", "اختر نوع إضافة مورد واحدًا فقط");
const planSchema = z.object({
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9 &'()._-]{1,119}$/),
  descriptionAr: z.string().trim().max(2000).optional(),
  descriptionEn: z.string().trim().max(2000).optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/).optional(),
  billingCycle: cycleSchema,
  customDays: z.number().int().min(1).max(3650).nullable().optional(),
  priceMinor: z.number().int().min(1).max(100_000_000_00),
  currency: z.literal("EGP").default("EGP"),
  features: featuresSchema.default({}),
  maxUsers: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxBranches: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxWarehouses: z.number().int().min(0).max(1_000_000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.billingCycle === "custom_days" && !value.customDays) context.addIssue({ code: "custom", path: ["customDays"], message: "مدة الباقة المخصصة مطلوبة" });
  if (value.billingCycle !== "custom_days" && value.customDays != null) context.addIssue({ code: "custom", path: ["customDays"], message: "المدة المخصصة لا تستخدم مع هذه الدورة" });
  const catalogKind = classifyCatalogFeatures(value.features).kind;
  if (catalogKind === "invalid_addon") context.addIssue({ code: "custom", path: ["features"], message: "اختر إضافة مورد واحدة فقط" });
  if (catalogKind === "plan" && [value.maxUsers, value.maxBranches, value.maxWarehouses].some((limit) => limit === undefined)) {
    context.addIssue({ code: "custom", path: ["maxUsers"], message: "أدخل حدود الاستخدام أو اختر غير محدود لكل مورد" });
  }
  if (catalogKind === "addon" && [value.maxUsers, value.maxBranches, value.maxWarehouses].some((limit) => typeof limit === "number")) {
    context.addIssue({ code: "custom", path: ["maxUsers"], message: "لا تُسند حدود باقة إلى إضافة مورد" });
  }
});

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  await ensurePlatformPlanDescriptionColumns();
  const rows = await access.context.db.select().from(platformPlans).orderBy(asc(platformPlans.priceMinor));
  return Response.json({ plans: rows.map(formatPlan) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  await ensurePlatformPlanDescriptionColumns();
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const parsed = planSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "بيانات الباقة غير صالحة" }, { status: 400 });
  const { db } = access.context;
  const code = parsed.data.code ?? defaultCatalogCode(parsed.data.nameEn, parsed.data.billingCycle, parsed.data.customDays);
  const [duplicate] = await db.select({ id: platformPlans.id }).from(platformPlans).where(eq(platformPlans.code, code)).limit(1);
  if (duplicate) return Response.json({ error: "رمز الباقة الداخلي مستخدم بالفعل" }, { status: 409 });
  const id = crypto.randomUUID();
  const now = new Date();
  const values = { id, nameAr: parsed.data.nameAr, nameEn: parsed.data.nameEn, descriptionAr: parsed.data.descriptionAr ?? "", descriptionEn: parsed.data.descriptionEn ?? "", code, billingCycle: parsed.data.billingCycle, customDays: parsed.data.customDays ?? null, priceMinor: parsed.data.priceMinor, currency: "EGP", featuresJson: JSON.stringify(parsed.data.features), maxUsers: parsed.data.maxUsers ?? null, maxBranches: parsed.data.maxBranches ?? null, maxWarehouses: parsed.data.maxWarehouses ?? null, isActive: true, createdAt: now, updatedAt: now };
  try {
    await db.insert(platformPlans).values(values).run();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return Response.json({ errorCode: "conflict", error: "يوجد عنصر كتالوج بنفس الرمز أو الاسم الإنجليزي" }, { status: 409 });
    console.error("[platform-plans] create failed", cause);
    return Response.json({ errorCode: "databaseError", error: "تعذر حفظ الباقة. تحقق من بنية قاعدة البيانات ثم أعد المحاولة." }, { status: 500 });
  }
  // Auditing must never turn a successful catalog write into a failed request.
  await writePlatformAudit(access.context, request, "platform_plan.created", "platform_plan", id, { nameEn: values.nameEn, priceMinor: values.priceMinor, billingCycle: values.billingCycle }).catch((cause) => console.error("[platform-plans] audit failed after create", cause));
  return Response.json({ plan: formatPlan(values) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function formatPlan(plan: typeof platformPlans.$inferSelect | typeof platformPlans.$inferInsert) {
  let features: Record<string, boolean> = {};
  try { const value: unknown = JSON.parse(plan.featuresJson ?? "{}"); if (value && typeof value === "object" && !Array.isArray(value)) features = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")); } catch { features = {}; }
  const classification = classifyCatalogFeatures(features);
  return {
    ...plan,
    features,
    catalogKind: classification.kind === "invalid_addon" ? "invalid_addon" : classification.kind,
    addonResourceType: classification.kind === "addon" ? classification.resourceType : null,
  };
}
