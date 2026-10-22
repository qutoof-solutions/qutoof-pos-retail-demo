import { and, asc, eq, gte, lte } from "drizzle-orm";
import { branches, staffShifts, users } from "@/lib/db/schema";
import { requireOperationAccess } from "@/lib/server/operations";
export const runtime = "edge";
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]); if (!access.ok) return access.response;
  const now = new Date();
  const [branchRows, onDuty] = await Promise.all([
    access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).orderBy(asc(branches.name)),
    access.context.db.select({ branchId: staffShifts.branchId, branchName: branches.name, branchNameAr: branches.nameAr, branchNameEn: branches.nameEn, staffId: staffShifts.staffId, staffName: users.fullName, staffRole: users.role, department: staffShifts.department, shiftType: staffShifts.shiftType, endsAt: staffShifts.endsAt }).from(staffShifts).innerJoin(branches, and(eq(branches.id, staffShifts.branchId), eq(branches.tenantId, access.context.tenantId))).innerJoin(users, and(eq(users.id, staffShifts.staffId), eq(users.tenantId, access.context.tenantId))).where(and(eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.isActive, true), lte(staffShifts.startsAt, now), gte(staffShifts.endsAt, now), eq(users.isActive, true))).orderBy(asc(branches.name), asc(users.fullName)),
  ]);
  const coveredIds = new Set(onDuty.map((row) => row.branchId));
  return Response.json({ asOf: now.toISOString(), coveredBranches: branchRows.filter((row) => coveredIds.has(row.id)).map((row) => ({ ...row, staff: onDuty.filter((item) => item.branchId === row.id) })), uncoveredBranches: branchRows.filter((row) => !coveredIds.has(row.id)), onDuty }, { headers: { "Cache-Control": "no-store" } });
}
