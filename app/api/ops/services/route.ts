import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { branches, services } from "@/lib/db/schema";
import { serviceInput } from "@/lib/operations/service-validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
async function validateBranch(context: { db: ReturnType<typeof import("@/lib/db/client").getDb>; tenantId: string }, branchId: string | null): Promise<void> {
  if (!branchId) return;
  const [branch] = await context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, context.tenantId))).limit(1);
  if (!branch) throw new ApiError("الفرع المحدد غير موجود في مساحة العمل", 404);
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const branchIds = await getAccessibleBranchIds(access.context);
  if (!branchIds.length) return Response.json({ services: [] }, { headers: { "Cache-Control": "no-store" } });
  const rows = await access.context.db.select().from(services).where(and(eq(services.tenantId, access.context.tenantId), or(isNull(services.branchId), inArray(services.branchId, branchIds)))).orderBy(asc(services.name));
  return Response.json({ services: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = serviceInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات الخدمة أو الباقة غير صالحة");
    const input = parsed.data;
    if (input.branchId) await requireBranchMembership(access.context, input.branchId);
    else await requireAllActiveBranchMemberships(access.context);
    await validateBranch(access.context, input.branchId);
    if (input.kind === "single" && (input.sessionCount !== 1 || input.validityDays !== null)) throw new ApiError("الخدمة المفردة لا تحتوي عدد جلسات أو مدة صلاحية");
    if (input.kind !== "single" && input.sessionCount < 2) throw new ApiError("يجب أن تحتوي الباقة أو الاشتراك على جلستين على الأقل");
    const id = crypto.randomUUID();
    const [created] = await access.context.db.insert(services).values({ id, tenantId: access.context.tenantId, branchId: input.branchId, name: input.name, description: input.description ?? null, kind: input.kind, priceMinor: Math.round(input.price * 100), currency: "EGP", durationMinutes: input.durationMinutes, providerCommissionBps: Math.round(input.providerCommissionPercent * 100), providerCommissionMode: input.providerCommissionMode, providerCommissionFixedMinor: Math.round(input.providerCommissionFixed * 100), sessionCount: input.sessionCount, validityDays: input.validityDays, isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, "service.created", "service", id, { kind: input.kind });
    return Response.json({ service: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
