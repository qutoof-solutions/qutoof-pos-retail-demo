import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { staffAttendance, staffShifts, users, branches } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
function validDate(value: string | null): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const branchId = url.searchParams.get("branchId")?.trim() || null;
    if (!validDate(from) || !validDate(to) || from > to) return Response.json({ error: "حدد فترة زمنية صحيحة" }, { status: 400 });
    const accessibleBranchIds = await getAccessibleBranchIds(access.context);
    if (branchId) await requireBranchMembership(access.context, branchId);
    const scopedBranchIds = branchId ? [branchId] : accessibleBranchIds;
    if (!scopedBranchIds.length) return Response.json({ period: { from, to, timezone: access.context.tenant.timezone }, branches: [], rows: [], summary: { totalMinutes: 0, lateCount: 0, staffCount: 0 }, byBranch: [] }, { headers: { "Cache-Control": "no-store" } });
    const [rows, branchRows] = await Promise.all([
      access.context.db.select({ id: staffAttendance.id, workDate: staffAttendance.workDate, branchId: staffAttendance.branchId, branchName: branches.name, branchNameAr: branches.nameAr, branchNameEn: branches.nameEn, staffId: staffAttendance.staffId, staffName: users.fullName, staffRole: users.role, shiftId: staffAttendance.shiftId, shiftType: staffShifts.shiftType, shiftStartsAt: staffShifts.startsAt, clockIn: staffAttendance.clockIn, clockOut: staffAttendance.clockOut, totalMinutes: staffAttendance.totalMinutes, lateMinutes: staffAttendance.lateMinutes, status: staffAttendance.status }).from(staffAttendance).innerJoin(branches, and(eq(branches.id, staffAttendance.branchId), eq(branches.tenantId, access.context.tenantId))).innerJoin(users, and(eq(users.id, staffAttendance.staffId), eq(users.tenantId, access.context.tenantId))).leftJoin(staffShifts, and(eq(staffShifts.id, staffAttendance.shiftId), eq(staffShifts.tenantId, access.context.tenantId))).where(and(eq(staffAttendance.tenantId, access.context.tenantId), inArray(staffAttendance.branchId, scopedBranchIds), gte(staffAttendance.workDate, from), lte(staffAttendance.workDate, to))).orderBy(asc(staffAttendance.workDate), asc(branches.name), asc(users.fullName)),
      access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), inArray(branches.id, scopedBranchIds))).orderBy(asc(branches.name)),
    ]);
    const byBranch = branchRows.map((branch) => { const branchRowsForSummary = rows.filter((row) => row.branchId === branch.id); return { id: branch.id, name: branch.name, nameAr: branch.nameAr, nameEn: branch.nameEn, staffCount: new Set(branchRowsForSummary.map((row) => row.staffId)).size, totalMinutes: branchRowsForSummary.reduce((sum, row) => sum + row.totalMinutes, 0), lateCount: branchRowsForSummary.filter((row) => row.lateMinutes > 0).length }; });
    return Response.json({ period: { from, to, timezone: access.context.tenant.timezone }, branches: branchRows, rows, summary: { totalMinutes: rows.reduce((sum, row) => sum + row.totalMinutes, 0), lateCount: rows.filter((row) => row.lateMinutes > 0).length, staffCount: new Set(rows.map((row) => row.staffId)).size }, byBranch }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر إنشاء تقرير الحضور"); }
}
