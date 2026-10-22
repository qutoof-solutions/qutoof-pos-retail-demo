import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { suppliers } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireAllActiveBranchMemberships } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    await requireAllActiveBranchMemberships(access.context);
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError("معرف المورد غير صالح");
    const parsed = z.object({ isActive: z.boolean() }).safeParse(await request.json());
    if (!parsed.success) throw new ApiError("حالة المورد غير صالحة");
    const [supplier] = await access.context.db.update(suppliers).set({ isActive: parsed.data.isActive, updatedAt: new Date() }).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, access.context.tenantId))).returning({ id: suppliers.id, name: suppliers.name, isActive: suppliers.isActive });
    if (!supplier) throw new ApiError("المورد غير موجود", 404);
    await writeAudit(access.context, request, parsed.data.isActive ? "supplier.activated" : "supplier.deactivated", "supplier", id);
    return Response.json({ supplier });
  } catch (error) { return errorResponse(error); }
}
