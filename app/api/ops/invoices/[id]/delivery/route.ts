import { and, eq } from "drizzle-orm";
import { invoices } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { deliveryStatusBodySchema, type DeliveryStatus } from "@/lib/operations/delivery-status";
import { z } from "zod";

export const runtime = "edge";
const bodySchema = deliveryStatusBodySchema;
type RouteContext = { params: Promise<{ id: string }> };
const rank: Record<DeliveryStatus, number> = { preparing: 0, out_for_delivery: 1, delivered: 2 };

export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError("معرف الفاتورة غير صالح", 400);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || "حالة التوصيل غير صالحة");
    const [invoice] = await access.context.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, access.context.tenantId))).limit(1);
    if (!invoice) throw new ApiError("الفاتورة غير موجودة", 404);
    await requireBranchMembership(access.context, invoice.branchId);
    if (invoice.orderType !== "delivery") throw new ApiError("هذه الفاتورة ليست طلب توصيل", 409);
    const current = invoice.deliveryStatus ?? "preparing";
    if (rank[parsed.data.deliveryStatus] < rank[current]) throw new ApiError("لا يمكن إرجاع حالة التوصيل إلى مرحلة سابقة", 409);
    if (rank[parsed.data.deliveryStatus] > rank[current] + 1) throw new ApiError("حدّث حالة التوصيل إلى المرحلة التالية فقط", 409);
    if (parsed.data.deliveryStatus === current) return Response.json({ invoice }, { headers: { "Cache-Control": "no-store" } });
    const [updated] = await access.context.db.update(invoices).set({ deliveryStatus: parsed.data.deliveryStatus, updatedAt: new Date() }).where(and(eq(invoices.id, id), eq(invoices.tenantId, access.context.tenantId), eq(invoices.deliveryStatus, current))).returning();
    if (!updated) throw new ApiError("تغيرت حالة الطلب بالتزامن؛ أعد تحميل الصفحة", 409);
    await writeAudit(access.context, request, "invoice.delivery_status_changed", "invoice", id, { from: current, to: parsed.data.deliveryStatus });
    return Response.json({ invoice: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
