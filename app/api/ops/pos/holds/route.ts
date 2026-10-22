import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { posHeldSales } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess, ApiError, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const payloadSchema = z.object({ branchId: uuidSchema, customerId: uuidSchema.nullable().optional(), label: z.string().trim().max(120).nullable().optional(), payload: z.record(z.string(), z.unknown()) });
const actionSchema = z.object({ action: z.enum(["recall", "cancel"]), id: uuidSchema });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId || !uuidSchema.safeParse(branchId).success) throw new ApiError("الفرع مطلوب");
    await requireBranchMembership(access.context, branchId);
    const rows = await access.context.db.select().from(posHeldSales).where(and(eq(posHeldSales.tenantId, access.context.tenantId), eq(posHeldSales.branchId, branchId), eq(posHeldSales.status, "held"))).orderBy(desc(posHeldSales.createdAt));
    return Response.json({ holds: rows.map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات الفاتورة المعلقة غير صالحة");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const now = new Date();
    const [hold] = await access.context.db.insert(posHeldSales).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, branchId: input.branchId, customerId: input.customerId ?? null, label: input.label?.trim() || null, payloadJson: JSON.stringify(input.payload), status: "held", createdBy: access.context.user.id, createdAt: now, updatedAt: now }).returning();
    await writeAudit(access.context, request, "pos.sale_held", "pos_held_sale", hold!.id, { branchId: input.branchId });
    return Response.json({ hold: { ...hold, payload: input.payload } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("إجراء الفاتورة المعلقة غير صالح");
    const [hold] = await access.context.db.select().from(posHeldSales).where(and(eq(posHeldSales.id, parsed.data.id), eq(posHeldSales.tenantId, access.context.tenantId), eq(posHeldSales.status, "held"))).limit(1);
    if (!hold) throw new ApiError("الفاتورة المعلقة غير موجودة أو تم استعادتها", 404);
    const now = new Date();
    const [updated] = await access.context.db.update(posHeldSales).set({ status: parsed.data.action === "recall" ? "recalled" : "cancelled", recalledAt: parsed.data.action === "recall" ? now : null, updatedAt: now }).where(and(eq(posHeldSales.id, hold.id), eq(posHeldSales.tenantId, access.context.tenantId), eq(posHeldSales.status, "held"))).returning();
    await writeAudit(access.context, request, `pos.sale_${parsed.data.action === "recall" ? "recalled" : "cancelled"}`, "pos_held_sale", hold.id, {});
    return Response.json({ hold: updated ? { ...updated, payload: JSON.parse(updated.payloadJson) } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
