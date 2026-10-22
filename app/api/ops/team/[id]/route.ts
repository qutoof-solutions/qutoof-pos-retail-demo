import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/lib/db/schema";
import { isOwnerRole } from "@/lib/operations/permissions";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const inputSchema = z.object({ isActive: z.boolean() });

export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  if (!isOwnerRole(access.context.session.role)) return Response.json({ error: "إدارة حسابات الفريق متاحة لمالك النشاط فقط" }, { status: 403 });
  try {
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError("معرف الموظف غير صالح");
    if (id === access.context.session.sub) throw new ApiError("لا يمكن تعطيل حسابك الحالي", 409);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("حالة الحساب غير صالحة");
    const [member] = await access.context.db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(and(eq(users.id, id), eq(users.tenantId, access.context.tenantId), ne(users.role, "super_admin"))).limit(1);
    if (!member) throw new ApiError("الموظف غير موجود", 404);
    if (member.role === "business_admin" || member.role === "owner") throw new ApiError("لا يمكن إيقاف حساب مالك النشاط من إدارة الفريق", 403);
    const [updated] = await access.context.db.update(users).set({ isActive: parsed.data.isActive, updatedAt: new Date() }).where(and(eq(users.id, id), eq(users.tenantId, access.context.tenantId))).returning({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, isActive: users.isActive });
    await writeAudit(access.context, request, parsed.data.isActive ? "team_member.activated" : "team_member.deactivated", "user", id, { role: member.role });
    return Response.json({ member: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
