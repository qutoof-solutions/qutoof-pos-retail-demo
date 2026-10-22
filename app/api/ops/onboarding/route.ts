import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { branches, schedules, tenants } from "@/lib/db/schema";
import { VERTICALS } from "@/lib/terms";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { readTenantOnboardingState, writeTenantOnboardingState } from "@/lib/operations/onboarding";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";

const identityInput = z.object({
  action: z.literal("save_identity"),
  name: z.string().trim().min(2).max(120),
  vertical: z.enum(VERTICALS),
  logoUrl: z.string().trim().max(500).refine((value) => value === "" || (value.startsWith("https://") && z.string().url().safeParse(value).success), "رابط الشعار يجب أن يكون HTTPS صالحاً").default(""),
}).strict();
const completeInput = z.object({ action: z.literal("complete"), branchId: z.string().uuid() }).strict();

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  const branchIds = await getAccessibleBranchIds(access.context);
  const [branchRows, scheduleRows] = await Promise.all([
    branchIds.length ? access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn, isActive: branches.isActive }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), inArray(branches.id, branchIds))) : Promise.resolve([]),
    branchIds.length ? access.context.db.select({ branchId: schedules.branchId, weekday: schedules.weekday }).from(schedules).where(and(eq(schedules.tenantId, access.context.tenantId), inArray(schedules.branchId, branchIds), isNull(schedules.providerId))) : Promise.resolve([]),
  ]);
  const scheduleDaysByBranch: Record<string, number[]> = {};
  for (const row of scheduleRows) {
    if (!row.branchId) continue;
    (scheduleDaysByBranch[row.branchId] ??= []).push(row.weekday);
  }
  const state = readTenantOnboardingState(access.context.tenant.settingsJson);
  return Response.json({
    tenant: { name: access.context.tenant.name, vertical: access.context.tenant.vertical, logoUrl: access.context.tenant.logoUrl ?? "" },
    onboarding: state,
    branches: branchRows,
    scheduleDaysByBranch,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  try {
    const body: unknown = await request.json();
    const action = body && typeof body === "object" && "action" in body ? (body as { action?: unknown }).action : undefined;
    if (action === "save_identity") {
      const parsed = identityInput.safeParse(body);
      if (!parsed.success) throw new ApiError("تحقق من اسم المنشأة والتخصص ورابط الشعار");
      const { name, vertical, logoUrl } = parsed.data;
      const now = new Date();
      await access.context.db.update(tenants).set({ name, vertical, logoUrl: logoUrl || null, updatedAt: now }).where(eq(tenants.id, access.context.tenantId)).run();
      await writeAudit(access.context, request, "tenant.onboarding_identity_saved", "tenant", access.context.tenantId, { vertical, hasLogo: Boolean(logoUrl) });
      return Response.json({ saved: true });
    }
    if (action === "complete") {
      const parsed = completeInput.safeParse(body);
      if (!parsed.success) throw new ApiError("حدد فرعًا صحيحًا لإكمال الإعداد");
      await requireBranchMembership(access.context, parsed.data.branchId);
      const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, parsed.data.branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
      if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط في مساحة العمل", 404);
      const days = await access.context.db.select({ weekday: schedules.weekday }).from(schedules).where(and(eq(schedules.tenantId, access.context.tenantId), eq(schedules.branchId, branch.id), isNull(schedules.providerId)));
      if (new Set(days.map((row) => row.weekday)).size !== 7) throw new ApiError("أكمل جدول أيام الأسبوع السبعة للفرع قبل إنهاء الإعداد");
      const state = readTenantOnboardingState(access.context.tenant.settingsJson);
      const settingsJson = writeTenantOnboardingState(access.context.tenant.settingsJson, { required: false, version: Math.max(1, state.version), completedAt: new Date().toISOString() });
      await access.context.db.update(tenants).set({ settingsJson, updatedAt: new Date() }).where(eq(tenants.id, access.context.tenantId)).run();
      await writeAudit(access.context, request, "tenant.onboarding_completed", "tenant", access.context.tenantId, { branchId: branch.id });
      return Response.json({ completed: true });
    }
    throw new ApiError("الإجراء غير معروف");
  } catch (error) {
    return errorResponse(error);
  }
}
