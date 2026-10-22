import { and, asc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { branchMemberships, branches, users } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { STAFF_ASSIGNABLE_ROLES } from "@/lib/operations/permissions";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";

const updateSchema = z.object({
  userId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.branchIds).size !== value.branchIds.length) {
    ctx.addIssue({ code: "custom", path: ["branchIds"], message: "توجد فروع مكررة" });
  }
});

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const accessibleBranchIds = await getAccessibleBranchIds(access.context);
  if (!accessibleBranchIds.length) return Response.json({ staff: [], memberships: [], branches: [] }, { headers: { "Cache-Control": "no-store" } });
  const [staff, memberships] = await Promise.all([
    access.context.db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.tenantId, access.context.tenantId), inArray(users.role, [...STAFF_ASSIGNABLE_ROLES])))
      .orderBy(asc(users.fullName)),
    access.context.db.select({ userId: branchMemberships.userId, branchId: branchMemberships.branchId })
      .from(branchMemberships)
      .where(and(eq(branchMemberships.tenantId, access.context.tenantId), inArray(branchMemberships.branchId, accessibleBranchIds))),
  ]);
  const branchRows = await access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true), inArray(branches.id, accessibleBranchIds))).orderBy(asc(branches.name));
  return Response.json({ staff, memberships, branches: branchRows }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات إسناد الفروع غير صحيحة");
    const { userId, branchIds } = parsed.data;
    for (const branchId of branchIds) await requireBranchMembership(access.context, branchId);
    const [member] = await access.context.db.select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, access.context.tenantId), eq(users.isActive, true), inArray(users.role, [...STAFF_ASSIGNABLE_ROLES])))
      .limit(1);
    if (!member) throw new ApiError("المستخدم غير موجود أو غير نشط أو لا يمكن إسناده من هذه الشاشة", 404);
    if (branchIds.length) {
      const rows = await access.context.db.select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true), inArray(branches.id, branchIds)));
      if (rows.length !== branchIds.length) throw new ApiError("تتضمن القائمة فرعًا غير نشط أو خارج مساحة العمل", 400);
    }
    const currentMemberships = await access.context.db.select({ branchId: branchMemberships.branchId }).from(branchMemberships).where(and(eq(branchMemberships.tenantId, access.context.tenantId), eq(branchMemberships.userId, userId)));
    const accessibleBranchIds = await getAccessibleBranchIds(access.context);
    const preservedBranchIds = currentMemberships.map((row) => row.branchId).filter((branchId) => !accessibleBranchIds.includes(branchId));
    const finalBranchIds = [...new Set([...preservedBranchIds, ...branchIds])];
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      access.context.db.delete(branchMemberships).where(and(eq(branchMemberships.tenantId, access.context.tenantId), eq(branchMemberships.userId, userId))),
      ...finalBranchIds.map((branchId) => access.context.db.insert(branchMemberships).values({
        id: crypto.randomUUID(), tenantId: access.context.tenantId, userId, branchId, createdAt: new Date(),
      })),
    ];
    await access.context.db.batch(statements);
    await writeAudit(access.context, request, "branch.memberships_updated", "user", userId, { branchCount: branchIds.length });
    return Response.json({ saved: true, branchIds: finalBranchIds }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
