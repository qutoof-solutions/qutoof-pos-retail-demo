import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { branches, services, tenantPublicProfiles, tenants } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { hasManualPaymentSettings } from "@/lib/operations/manual-payment";
import { DEFAULT_BOOKING_POLICY } from "@/lib/operations/booking-policy";
import { requireAllActiveBranchMemberships } from "@/lib/server/branch-access";

export const runtime = "edge";
const httpsUrl = z.string().trim().max(2048).refine((value) => value === "" || (value.startsWith("https://") && z.string().url().safeParse(value).success), "يجب أن يكون الرابط HTTPS صالحاً").default("");
const profileInput = z.object({
  description: z.string().trim().max(1200),
  bookingEnabled: z.boolean(),
  acceptElectronicRequest: z.boolean(),
  googleReviewUrl: z.union([z.string().url().max(500), z.literal("")]).default(""),
  logoUrl: z.union([z.string().url().max(500), z.literal("")]).default(""),
  mobileWalletLabel: z.string().trim().max(80).default(""),
  mobileWalletNumber: z.string().trim().max(30).regex(/^$|^\+?[0-9\s()\-]{7,30}$/).default(""),
  instapayLink: httpsUrl,
  instapayQrUrl: httpsUrl,
  paymentInstructions: z.string().trim().max(1000).default(""),
  invoiceTerms: z.string().trim().max(4000).default(""),
  invoiceNotes: z.string().trim().max(2000).default(""),
  cancellationLeadMinutes: z.number().int().min(0).max(10_080).default(DEFAULT_BOOKING_POLICY.cancellationLeadMinutes),
  maxReschedules: z.number().int().min(0).max(10).default(DEFAULT_BOOKING_POLICY.maxReschedules),
  depositRequired: z.boolean().default(false),
  depositPercentBps: z.number().int().min(0).max(10_000).default(0),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  await requireAllActiveBranchMemberships(access.context);
  const [profile] = await access.context.db.select().from(tenantPublicProfiles).where(eq(tenantPublicProfiles.tenantId, access.context.tenantId)).limit(1);
  return Response.json({ profile: {
    description: profile?.description ?? "",
    bookingEnabled: profile?.bookingEnabled ?? false,
    acceptElectronicRequest: profile?.acceptElectronicRequest ?? false,
    googleReviewUrl: profile?.googleReviewUrl ?? "",
    logoUrl: access.context.tenant.logoUrl ?? "",
    mobileWalletLabel: profile?.mobileWalletLabel ?? "",
    mobileWalletNumber: profile?.mobileWalletNumber ?? "",
    instapayLink: profile?.instapayLink ?? "",
    instapayQrUrl: profile?.instapayQrUrl ?? "",
    paymentInstructions: profile?.paymentInstructions ?? "",
    invoiceTerms: profile?.invoiceTerms ?? "",
    invoiceNotes: profile?.invoiceNotes ?? "",
    cancellationLeadMinutes: profile?.cancellationLeadMinutes ?? DEFAULT_BOOKING_POLICY.cancellationLeadMinutes,
    maxReschedules: profile?.maxReschedules ?? DEFAULT_BOOKING_POLICY.maxReschedules,
    depositRequired: profile?.depositRequired ?? DEFAULT_BOOKING_POLICY.depositRequired,
    depositPercentBps: profile?.depositPercentBps ?? DEFAULT_BOOKING_POLICY.depositPercentBps,
    slug: access.context.tenant.slug,
    publicUrlPath: `/${access.context.tenant.slug}`,
  } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  await requireAllActiveBranchMemberships(access.context);
  try {
    const parsed = profileInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من وصف المنشأة ورابط التقييم والسياسات وبيانات التحصيل");
    const input = parsed.data;
    if (input.acceptElectronicRequest && !hasManualPaymentSettings(input)) throw new ApiError("أدخل رقم محفظة أو رابط InstaPay قبل إتاحة هذا الخيار للعملاء");
    if (input.depositRequired && input.depositPercentBps < 1) throw new ApiError("حدد نسبة عربون أكبر من صفر قبل إلزام العميل بالدفع المسبق");
    if (input.depositRequired && (!input.acceptElectronicRequest || !hasManualPaymentSettings(input))) throw new ApiError("العربون الإلزامي يتطلب تفعيل طلب الدفع وإدخال بيانات تحصيل يدوية صالحة");
    if (input.bookingEnabled) {
      const [branchCount] = await access.context.db.select({ value: count() }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true)));
      const [serviceCount] = await access.context.db.select({ value: count() }).from(services).where(and(eq(services.tenantId, access.context.tenantId), eq(services.isActive, true)));
      if (!branchCount?.value || !serviceCount?.value) throw new ApiError("أضف فرعاً وخدمة نشطة واحدة على الأقل قبل تفعيل الحجز العام");
    }
    const id = crypto.randomUUID();
    const now = new Date();
    const paymentFields = { mobileWalletLabel: input.mobileWalletLabel, mobileWalletNumber: input.mobileWalletNumber, instapayLink: input.instapayLink, instapayQrUrl: input.instapayQrUrl, paymentInstructions: input.paymentInstructions };
    const printFields = { invoiceTerms: input.invoiceTerms, invoiceNotes: input.invoiceNotes };
    const policyFields = { cancellationLeadMinutes: input.cancellationLeadMinutes, maxReschedules: input.maxReschedules, depositRequired: input.depositRequired, depositPercentBps: input.depositPercentBps };
    const [profile] = await access.context.db.insert(tenantPublicProfiles).values({ id, tenantId: access.context.tenantId, description: input.description, bookingEnabled: input.bookingEnabled, acceptElectronicRequest: input.acceptElectronicRequest, googleReviewUrl: input.googleReviewUrl || null, ...paymentFields, ...printFields, ...policyFields, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: tenantPublicProfiles.tenantId, set: { description: input.description, bookingEnabled: input.bookingEnabled, acceptElectronicRequest: input.acceptElectronicRequest, googleReviewUrl: input.googleReviewUrl || null, ...paymentFields, ...printFields, ...policyFields, updatedAt: now } }).returning();
    await access.context.db.update(tenants).set({ logoUrl: input.logoUrl || null, updatedAt: now }).where(eq(tenants.id, access.context.tenantId)).run();
    await writeAudit(access.context, request, "public_profile.updated", "tenant_public_profile", profile?.id ?? null, { bookingEnabled: input.bookingEnabled, electronicRequest: input.acceptElectronicRequest, depositRequired: input.depositRequired });
    return Response.json({ profile: { ...profile, logoUrl: input.logoUrl, slug: access.context.tenant.slug, publicUrlPath: `/${access.context.tenant.slug}` } });
  } catch (error) { return errorResponse(error); }
}
