import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { branches, services } from "@/lib/db/schema";
import { serviceInput } from "@/lib/operations/service-validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    const parsedId = z.string().uuid().safeParse(id);
    const parsed = serviceInput.safeParse(await request.json());
    if (!parsedId.success || !parsed.success) throw new ApiError("معرف أو بيانات الخدمة غير صالحة");
    const input = parsed.data;
    const [existing] = await access.context.db.select({ id: services.id, branchId: services.branchId }).from(services).where(and(eq(services.id, id), eq(services.tenantId, access.context.tenantId))).limit(1);
    if (!existing) throw new ApiError("الخدمة غير موجودة", 404);
    if (existing.branchId) await requireBranchMembership(access.context, existing.branchId);
    else await requireAllActiveBranchMemberships(access.context);
    if (input.branchId) {
      await requireBranchMembership(access.context, input.branchId);
      const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, access.context.tenantId))).limit(1);
      if (!branch) throw new ApiError("الفرع المحدد لا ينتمي لمساحة العمل", 404);
    } else await requireAllActiveBranchMemberships(access.context);
    if (input.kind === "single" && (input.sessionCount !== 1 || input.validityDays !== null)) throw new ApiError("الخدمة المفردة لا تحتوي عدد جلسات أو مدة صلاحية");
    if (input.kind !== "single" && input.sessionCount < 2) throw new ApiError("يجب أن تحتوي الباقة أو الاشتراك على جلستين على الأقل");
    const [updated] = await access.context.db.update(services).set({ branchId: input.branchId, name: input.name, description: input.description ?? null, kind: input.kind, priceMinor: Math.round(input.price * 100), durationMinutes: input.durationMinutes, providerCommissionBps: Math.round(input.providerCommissionPercent * 100), providerCommissionMode: input.providerCommissionMode, providerCommissionFixedMinor: Math.round(input.providerCommissionFixed * 100), sessionCount: input.sessionCount, validityDays: input.validityDays, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.tenantId, access.context.tenantId))).returning();
    if (!updated) throw new ApiError("الخدمة غير موجودة", 404);
    await writeAudit(access.context, request, "service.updated", "service", id, { kind: input.kind });
    return Response.json({ service: updated });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const { id } = await route.params;
  const [existing] = await access.context.db.select({ branchId: services.branchId }).from(services).where(and(eq(services.id, id), eq(services.tenantId, access.context.tenantId))).limit(1);
  if (!existing) return Response.json({ error: "الخدمة غير موجودة" }, { status: 404 });
  if (existing.branchId) await requireBranchMembership(access.context, existing.branchId);
  else await requireAllActiveBranchMemberships(access.context);
  const [updated] = await access.context.db.update(services).set({ isActive: false, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.tenantId, access.context.tenantId))).returning({ id: services.id });
  if (!updated) return Response.json({ error: "الخدمة غير موجودة" }, { status: 404 });
  await writeAudit(access.context, request, "service.archived", "service", id);
  return Response.json({ archived: true });
}
