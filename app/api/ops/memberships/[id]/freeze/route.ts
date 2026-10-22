import { and, eq } from "drizzle-orm";
import { customerMemberships, membershipFreezes } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { extendMembershipEndAt } from "@/lib/operations/membership-freeze";
import { z } from "zod";

export const runtime = "edge";
const inputSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(120), days: z.number().int().min(1).max(365), reason: z.string().trim().max(500).nullable().optional() });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  if (access.context.tenant.vertical !== "sports") return Response.json({ error: "إدارة عضويات الجيم متاحة للأنشطة الرياضية فقط" }, { status: 403 });
  try {
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError("معرف العضوية غير صالح", 400);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || "تحقق من مدة التجميد");
    const input = parsed.data;
    const payloadHash = await payloadFingerprint({ membershipId: id, days: input.days, reason: input.reason?.trim() || null });
    const { db, tenantId, env } = access.context;
    const [membership] = await db.select().from(customerMemberships).where(and(eq(customerMemberships.id, id), eq(customerMemberships.tenantId, tenantId))).limit(1);
    if (!membership) throw new ApiError("العضوية غير موجودة", 404);
    await requireBranchMembership(access.context, membership.branchId);

    const [existing] = await db.select().from(membershipFreezes).where(and(eq(membershipFreezes.tenantId, tenantId), eq(membershipFreezes.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ApiError("مفتاح التجميد مستخدم لطلب مختلف", 409);
      const [current] = await db.select().from(customerMemberships).where(and(eq(customerMemberships.id, id), eq(customerMemberships.tenantId, tenantId))).limit(1);
      return Response.json({ membership: current, freeze: existing, replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const nowMs = Date.now();
    const oldEndsAt = membership.endsAt.getTime();
    if (membership.status !== "active") throw new ApiError("لا يمكن تجميد عضوية ملغاة", 409);
    if (membership.startsAt.getTime() > nowMs) throw new ApiError("لا يمكن تجميد العضوية قبل تاريخ بدايتها", 409);
    if (oldEndsAt <= nowMs) throw new ApiError("انتهت العضوية بالفعل؛ لا يمكن تمديدها بالتجميد", 409);
    const newEndsAt = extendMembershipEndAt(new Date(oldEndsAt), parsed.data.days).getTime();
    const freezeId = crypto.randomUUID();
    const statements = [
      env.DB.prepare("UPDATE customer_memberships SET ends_at = ?, frozen_days_total = frozen_days_total + ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'active' AND ends_at = ? AND ends_at > ? AND NOT EXISTS (SELECT 1 FROM membership_freezes WHERE tenant_id = ? AND idempotency_key = ?) RETURNING id")
        .bind(newEndsAt, input.days, nowMs, id, tenantId, oldEndsAt, nowMs, tenantId, input.idempotencyKey),
      env.DB.prepare("INSERT INTO membership_freezes (id, tenant_id, membership_id, idempotency_key, payload_hash, days, old_ends_at, new_ends_at, reason, created_by, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
        .bind(freezeId, tenantId, id, input.idempotencyKey, payloadHash, input.days, oldEndsAt, newEndsAt, input.reason?.trim() || null, access.context.user.id, nowMs),
    ];
    const results = await env.DB.batch(statements);
    const updated = (results[0]?.results?.length ?? 0) > 0 || (results[0]?.meta?.changes ?? 0) > 0;
    const [savedFreeze] = await db.select().from(membershipFreezes).where(and(eq(membershipFreezes.tenantId, tenantId), eq(membershipFreezes.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!updated || !savedFreeze) {
      if (savedFreeze) {
        if (savedFreeze.payloadHash !== payloadHash) throw new ApiError("مفتاح التجميد مستخدم لطلب مختلف", 409);
        const [current] = await db.select().from(customerMemberships).where(and(eq(customerMemberships.id, id), eq(customerMemberships.tenantId, tenantId))).limit(1);
        return Response.json({ membership: current, freeze: savedFreeze, replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
      throw new ApiError("تغيرت العضوية بالتزامن أو انتهت؛ أعد تحميل الملف قبل المحاولة", 409);
    }
    const [current] = await db.select().from(customerMemberships).where(and(eq(customerMemberships.id, id), eq(customerMemberships.tenantId, tenantId))).limit(1);
    await writeAudit(access.context, request, "membership.frozen", "customer_membership", id, { days: input.days, oldEndsAt: new Date(oldEndsAt).toISOString(), newEndsAt: new Date(newEndsAt).toISOString(), freezeId });
    return Response.json({ membership: current, freeze: savedFreeze, replayed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
