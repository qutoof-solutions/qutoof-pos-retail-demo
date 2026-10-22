import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { appointments, branchMemberships, customerMemberships, customers, gymBodyMeasurements, gymPtSessionUsages, gymPtSessions, users } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit, type OperationContext } from "@/lib/server/operations";
import { getCustomerBranchScope } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";
import { canConsumePt, isMembershipValid } from "@/lib/operations/medical-contracts";

 type RouteContext = { params: Promise<{ id: string }> };
export const runtime = "edge";
const idempotencyKeySchema = z.string().trim().min(8).max(120);
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pt"), action: z.enum(["create", "consume"]), id: uuidSchema.optional(), membershipId: uuidSchema.nullable().optional(), trainerId: uuidSchema.nullable().optional(), appointmentId: uuidSchema.nullable().optional(), totalSessions: z.number().int().min(1).max(1000).optional(), notes: z.string().trim().max(1000).nullable().optional(), idempotencyKey: idempotencyKeySchema.optional() }),
  z.object({ kind: z.literal("inbody"), recordedAt: z.string().datetime().optional(), weightKg: z.number().positive().max(500).nullable().optional(), bodyFatPercent: z.number().min(0).max(100).nullable().optional(), muscleKg: z.number().positive().max(300).nullable().optional(), bmi: z.number().positive().max(100).nullable().optional(), measurements: z.record(z.string(), z.number().finite()).optional(), notes: z.string().trim().max(1000).nullable().optional(), idempotencyKey: idempotencyKeySchema.optional() }),
]);

type CustomerScope = Awaited<ReturnType<typeof getCustomerBranchScope>>;

async function hashPayload(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveWriteBranch(context: OperationContext, customerId: string, scope: CustomerScope): Promise<string | null> {
  if (scope.customerBranchId && scope.accessibleBranchIds.includes(scope.customerBranchId)) return scope.customerBranchId;
  if (!scope.appointmentIds.length) return null;
  const [appointment] = await context.db.select({ branchId: appointments.branchId }).from(appointments).where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.customerId, customerId), inArray(appointments.id, scope.appointmentIds), inArray(appointments.branchId, scope.accessibleBranchIds))).limit(1);
  return appointment?.branchId ?? null;
}

async function validMembership(context: OperationContext, customerId: string, membershipId: string, at: Date, scope: CustomerScope, expectedBranchId: string | null) {
  const [membership] = await context.db.select().from(customerMemberships).where(and(eq(customerMemberships.id, membershipId), eq(customerMemberships.tenantId, context.tenantId), eq(customerMemberships.customerId, customerId))).limit(1);
  if (!membership) throw new ApiError("عضوية الجيم غير موجودة لهذا العميل", 404);
  if (!scope.accessibleBranchIds.includes(membership.branchId)) throw new ApiError("لا تملك صلاحية الوصول إلى فرع العضوية", 403);
  if (expectedBranchId && membership.branchId !== expectedBranchId) throw new ApiError("العضوية لا تنتمي إلى فرع العميل", 409);
  if (!isMembershipValid(membership, at)) throw new ApiError("العضوية غير سارية؛ لا يمكن إنشاء أو استهلاك جلسة PT", 409);
  return membership;
}

async function validTrainer(context: OperationContext, trainerId: string | null | undefined, branchId: string | null, scope: CustomerScope) {
  if (!trainerId) return;
  const [trainer] = await context.db.select({ id: users.id }).from(users).innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, context.tenantId))).where(and(eq(users.id, trainerId), eq(users.tenantId, context.tenantId), eq(users.isActive, true), inArray(users.role, ["provider", "doctor", "specialist"]), inArray(branchMemberships.branchId, scope.accessibleBranchIds), ...(branchId ? [eq(branchMemberships.branchId, branchId)] : []))).limit(1);
  if (!trainer) throw new ApiError("المدرب غير صالح أو غير مرتبط بالفرع", 409);
}

async function validAppointment(context: OperationContext, appointmentId: string | null | undefined, customerId: string, scope: CustomerScope) {
  if (!appointmentId) return;
  if (!scope.appointmentIds.includes(appointmentId)) throw new ApiError("الموعد غير متاح لهذا العميل أو الفرع", 403);
  const [appointment] = await context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId), eq(appointments.customerId, customerId), inArray(appointments.branchId, scope.accessibleBranchIds))).limit(1);
  if (!appointment) throw new ApiError("الموعد غير موجود", 404);
}

async function customerAndScope(context: OperationContext, customerId: string) {
  const scope = await getCustomerBranchScope(context, customerId);
  const [customer] = await context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId))).limit(1);
  if (!customer) throw new ApiError("العميل غير موجود", 404);
  return scope;
}

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    if (access.context.tenant.vertical !== "sports") throw new ApiError("أدوات الجيم متاحة للمنشآت الرياضية فقط", 404);
    const { id } = await route.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("معرف العميل غير صالح");
    const scope = await customerAndScope(access.context, id);
    const branchFilter = or(isNull(gymPtSessions.branchId), inArray(gymPtSessions.branchId, scope.accessibleBranchIds));
    const measurementBranchFilter = or(isNull(gymBodyMeasurements.branchId), inArray(gymBodyMeasurements.branchId, scope.accessibleBranchIds));
    const [ptSessions, measurements, memberships] = await Promise.all([
      access.context.db.select().from(gymPtSessions).where(and(eq(gymPtSessions.tenantId, access.context.tenantId), eq(gymPtSessions.customerId, id), branchFilter)).orderBy(desc(gymPtSessions.createdAt)),
      access.context.db.select().from(gymBodyMeasurements).where(and(eq(gymBodyMeasurements.tenantId, access.context.tenantId), eq(gymBodyMeasurements.customerId, id), measurementBranchFilter)).orderBy(desc(gymBodyMeasurements.recordedAt)).limit(50),
      access.context.db.select().from(customerMemberships).where(and(eq(customerMemberships.tenantId, access.context.tenantId), eq(customerMemberships.customerId, id), inArray(customerMemberships.branchId, scope.accessibleBranchIds))).orderBy(desc(customerMemberships.createdAt)),
    ]);
    const usages = ptSessions.length ? await access.context.db.select().from(gymPtSessionUsages).where(and(eq(gymPtSessionUsages.tenantId, access.context.tenantId), eq(gymPtSessionUsages.customerId, id), inArray(gymPtSessionUsages.sessionId, ptSessions.map((session) => session.id)), or(isNull(gymPtSessionUsages.branchId), inArray(gymPtSessionUsages.branchId, scope.accessibleBranchIds)))).orderBy(desc(gymPtSessionUsages.consumedAt)) : [];
    return Response.json({ ptSessions, ptSessionUsages: usages, memberships, measurements }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    if (access.context.tenant.vertical !== "sports") throw new ApiError("أدوات الجيم متاحة للمنشآت الرياضية فقط", 404);
    const { id } = await route.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("معرف العميل غير صالح");
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات PT أو InBody غير صالحة");
    const scope = await customerAndScope(access.context, id);
    const now = new Date();
    const branchId = await resolveWriteBranch(access.context, id, scope);

    if (parsed.data.kind === "pt") {
      if (parsed.data.action === "consume") {
        if (!parsed.data.id || !parsed.data.idempotencyKey) throw new ApiError("معرف الجلسة ومفتاح العملية مطلوبان");
        await validAppointment(access.context, parsed.data.appointmentId, id, scope);
        const requestHash = await hashPayload({ kind: "pt", action: "consume", id, sessionId: parsed.data.id, branchId: branchId ?? null, appointmentId: parsed.data.appointmentId ?? null });
        const [existingUsage] = await access.context.db.select().from(gymPtSessionUsages).where(and(eq(gymPtSessionUsages.tenantId, access.context.tenantId), eq(gymPtSessionUsages.idempotencyKey, parsed.data.idempotencyKey))).limit(1);
        if (existingUsage) {
          if (existingUsage.payloadHash !== requestHash || existingUsage.customerId !== id || existingUsage.sessionId !== parsed.data.id) throw new ApiError("مفتاح العملية مستخدم لطلب مختلف", 409);
          const [replayed] = await access.context.db.select().from(gymPtSessions).where(and(eq(gymPtSessions.id, existingUsage.sessionId), eq(gymPtSessions.tenantId, access.context.tenantId), eq(gymPtSessions.customerId, id))).limit(1);
          if (!replayed) throw new ApiError("جلسة PT غير موجودة", 404);
          return Response.json({ session: replayed, usage: existingUsage, remaining: replayed.totalSessions - replayed.usedSessions, replayed: true });
        }
        const sessionBranchFilter = branchId ? or(isNull(gymPtSessions.branchId), eq(gymPtSessions.branchId, branchId)) : isNull(gymPtSessions.branchId);
        const [session] = await access.context.db.select().from(gymPtSessions).where(and(eq(gymPtSessions.id, parsed.data.id), eq(gymPtSessions.tenantId, access.context.tenantId), eq(gymPtSessions.customerId, id), sessionBranchFilter)).limit(1);
        if (!session) throw new ApiError("عداد PT غير موجود", 404);
        if (session.membershipId) await validMembership(access.context, id, session.membershipId, now, scope, session.branchId);
        if (!canConsumePt({ membershipValid: true, usedSessions: session.usedSessions, totalSessions: session.totalSessions })) throw new ApiError("لا توجد جلسة PT متاحة", 409);
        await validTrainer(access.context, session.trainerId, session.branchId, scope);
        try {
          const results = await access.context.env.DB.batch([
            access.context.env.DB.prepare("UPDATE gym_pt_sessions SET used_sessions = used_sessions + 1, updated_at = ? WHERE id = ? AND tenant_id = ? AND customer_id = ? AND used_sessions < total_sessions").bind(now.getTime(), session.id, access.context.tenantId, id),
            access.context.env.DB.prepare("INSERT INTO gym_pt_session_usages (id, tenant_id, branch_id, session_id, customer_id, actor_id, appointment_id, idempotency_key, payload_hash, consumed_at, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(crypto.randomUUID(), access.context.tenantId, session.branchId, session.id, id, access.context.user.id, parsed.data.appointmentId ?? null, parsed.data.idempotencyKey, requestHash, now.getTime(), now.getTime()),
          ]);
          if (!results[0]?.meta.changes) throw new ApiError("تم استهلاك الجلسة بالتزامن أو لا توجد جلسات متبقية", 409);
        } catch (error) {
          const [replayedUsage] = await access.context.db.select().from(gymPtSessionUsages).where(and(eq(gymPtSessionUsages.tenantId, access.context.tenantId), eq(gymPtSessionUsages.idempotencyKey, parsed.data.idempotencyKey))).limit(1);
          if (replayedUsage) {
            if (replayedUsage.payloadHash !== requestHash || replayedUsage.sessionId !== session.id || replayedUsage.customerId !== id) throw new ApiError("مفتاح العملية مستخدم لطلب مختلف", 409);
            const [replayedSession] = await access.context.db.select().from(gymPtSessions).where(eq(gymPtSessions.id, session.id)).limit(1);
            if (replayedSession) return Response.json({ session: replayedSession, usage: replayedUsage, remaining: replayedSession.totalSessions - replayedSession.usedSessions, replayed: true });
          }
          throw error;
        }
        const [updated, usage] = await Promise.all([
          access.context.db.select().from(gymPtSessions).where(eq(gymPtSessions.id, session.id)).limit(1),
          access.context.db.select().from(gymPtSessionUsages).where(and(eq(gymPtSessionUsages.tenantId, access.context.tenantId), eq(gymPtSessionUsages.idempotencyKey, parsed.data.idempotencyKey))).limit(1),
        ]);
        if (!updated[0] || !usage[0]) throw new ApiError("تعذر تسجيل استهلاك الجلسة", 500);
        await writeAudit(access.context, request, "gym.pt_session_consumed", "gym_pt_session", session.id, { remaining: updated[0].totalSessions - updated[0].usedSessions });
        return Response.json({ session: updated[0], usage: usage[0], remaining: updated[0].totalSessions - updated[0].usedSessions });
      }
      if (!parsed.data.totalSessions) throw new ApiError("عدد الحصص مطلوب");
      if (parsed.data.membershipId) await validMembership(access.context, id, parsed.data.membershipId, now, scope, branchId);
      await validTrainer(access.context, parsed.data.trainerId, branchId, scope);
      await validAppointment(access.context, parsed.data.appointmentId, id, scope);
      const createKey = parsed.data.idempotencyKey ?? `gym-pt-create:${crypto.randomUUID()}`;
      const requestHash = await hashPayload({ kind: "pt", action: "create", customerId: id, branchId, membershipId: parsed.data.membershipId ?? null, trainerId: parsed.data.trainerId ?? null, appointmentId: parsed.data.appointmentId ?? null, totalSessions: parsed.data.totalSessions, notes: parsed.data.notes ?? null });
      const [existing] = await access.context.db.select().from(gymPtSessions).where(and(eq(gymPtSessions.tenantId, access.context.tenantId), eq(gymPtSessions.idempotencyKey, createKey))).limit(1);
      if (existing) {
        if (existing.payloadHash !== requestHash || existing.customerId !== id) throw new ApiError("مفتاح العملية مستخدم لطلب مختلف", 409);
        return Response.json({ session: existing, replayed: true });
      }
      const [session] = await access.context.db.insert(gymPtSessions).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, branchId, customerId: id, membershipId: parsed.data.membershipId ?? null, trainerId: parsed.data.trainerId ?? null, totalSessions: parsed.data.totalSessions, usedSessions: 0, idempotencyKey: createKey, payloadHash: requestHash, notes: parsed.data.notes ?? null, createdBy: access.context.user.id, createdAt: now, updatedAt: now }).returning();
      await writeAudit(access.context, request, "gym.pt_session.created", "gym_pt_session", session!.id, { totalSessions: parsed.data.totalSessions });
      return Response.json({ session }, { status: 201 });
    }

    const requestHash = await hashPayload({ kind: "inbody", customerId: id, branchId, recordedAt: parsed.data.recordedAt ?? null, weightKg: parsed.data.weightKg ?? null, bodyFatPercent: parsed.data.bodyFatPercent ?? null, muscleKg: parsed.data.muscleKg ?? null, bmi: parsed.data.bmi ?? null, measurements: parsed.data.measurements ?? {}, notes: parsed.data.notes ?? null });
    if (parsed.data.idempotencyKey) {
      const [existing] = await access.context.db.select().from(gymBodyMeasurements).where(and(eq(gymBodyMeasurements.tenantId, access.context.tenantId), eq(gymBodyMeasurements.idempotencyKey, parsed.data.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.payloadHash !== requestHash || existing.customerId !== id) throw new ApiError("مفتاح العملية مستخدم لطلب مختلف", 409);
        return Response.json({ measurement: existing, replayed: true });
      }
    }
    const [measurement] = await access.context.db.insert(gymBodyMeasurements).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, branchId, customerId: id, idempotencyKey: parsed.data.idempotencyKey ?? null, payloadHash: parsed.data.idempotencyKey ? requestHash : null, recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : now, weightKg: parsed.data.weightKg === null || parsed.data.weightKg === undefined ? null : Math.round(parsed.data.weightKg * 100), bodyFatBps: parsed.data.bodyFatPercent === null || parsed.data.bodyFatPercent === undefined ? null : Math.round(parsed.data.bodyFatPercent * 100), muscleKg: parsed.data.muscleKg === null || parsed.data.muscleKg === undefined ? null : Math.round(parsed.data.muscleKg * 100), bmiBps: parsed.data.bmi === null || parsed.data.bmi === undefined ? null : Math.round(parsed.data.bmi * 100), measurementsJson: JSON.stringify(parsed.data.measurements ?? {}), notes: parsed.data.notes ?? null, recordedBy: access.context.user.id, createdAt: now }).returning();
    await writeAudit(access.context, request, "gym.inbody.recorded", "gym_body_measurement", measurement!.id, {});
    return Response.json({ measurement }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
