import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { staffShifts } from "@/lib/db/schema";
import { ApiError, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]); if (!access.ok) return access.response;
  const { id } = await route.params; if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "معرف الوردية غير صالح" }, { status: 400 });
  const [existing] = await access.context.db.select({ branchId: staffShifts.branchId }).from(staffShifts).where(and(eq(staffShifts.id, id), eq(staffShifts.tenantId, access.context.tenantId))).limit(1);
  if (!existing) return Response.json({ error: "الوردية غير موجودة" }, { status: 404 });
  await requireBranchMembership(access.context, existing.branchId);
  await access.context.db.update(staffShifts).set({ isActive: false, updatedAt: new Date() }).where(and(eq(staffShifts.id, id), eq(staffShifts.tenantId, access.context.tenantId)));
  await writeAudit(access.context, request, "staff_shift.cancelled", "staff_shift", id);
  return Response.json({ deleted: true });
}
export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]); if (!access.ok) return access.response;
  const { id } = await route.params; const body = await request.json().catch(() => null) as { notes?: string | null; maxAppointments?: number; isActive?: boolean } | null;
  if (!body || (body.maxAppointments !== undefined && (!Number.isInteger(body.maxAppointments) || body.maxAppointments < 0))) return Response.json({ error: "بيانات الوردية غير صالحة" }, { status: 400 });
  const [updated] = await access.context.db.update(staffShifts).set({ notes: body.notes, maxAppointments: body.maxAppointments, isActive: body.isActive, updatedAt: new Date() }).where(and(eq(staffShifts.id, id), eq(staffShifts.tenantId, access.context.tenantId))).returning();
  if (!updated) throw new ApiError("الوردية غير موجودة", 404);
  await writeAudit(access.context, request, "staff_shift.updated", "staff_shift", id);
  return Response.json({ shift: updated });
}
