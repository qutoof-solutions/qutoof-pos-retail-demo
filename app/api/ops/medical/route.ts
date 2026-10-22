import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, clinicalEncounters, customers, insuranceClaimEvents, insuranceClaims, insuranceContracts, invoices, labRequests, prescriptionTemplates, users } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { uuidSchema } from "@/lib/operations/validation";
import { isClinicalRole } from "@/lib/operations/permissions";
import { assertExpectedVersion, assertInsuranceClaimTransition, type InsuranceClaimStatus } from "@/lib/operations/medical-contracts";
import { canPerformInsuranceClaimTransition, claimCreationEventKey, claimEventPayload, claimTransitionEventKey, normalizeClaimEvent } from "@/lib/operations/medical-claims";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";
export const runtime = "edge";
const contractSchema = z.object({ name: z.string().trim().min(2).max(160), contractType: z.enum(["insurance", "union", "corporate"]), discountPercent: z.number().min(0).max(100), copayPercent: z.number().min(0).max(100), memberNumberLabel: z.string().trim().max(80).default("رقم العضوية") });
const templateSchema = z.object({ name: z.string().trim().min(2).max(160), items: z.array(z.object({ medicineName: z.string().trim().min(1).max(160), dose: z.string().trim().max(80), doseUnit: z.string().trim().max(40), frequency: z.string().trim().max(120), duration: z.string().trim().max(40), durationUnit: z.string().trim().max(40), route: z.string().trim().max(80), warnings: z.string().trim().max(2000).default("") })).min(1).max(50) });
const labSchema = z.object({ customerId: uuidSchema, encounterId: uuidSchema.nullable().optional(), requestType: z.enum(["lab", "radiology"]), tests: z.array(z.string().trim().min(1).max(180)).min(1).max(50), clinicalNotes: z.string().trim().max(4000).nullable().optional() });
const claimSchema = z.object({ invoiceId: uuidSchema, contractId: uuidSchema, idempotencyKey: z.string().trim().min(8).max(120), memberNumber: z.string().trim().max(120).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });
const claimTransitionSchema = z.object({ action: z.literal("claim_status"), claimId: uuidSchema, nextStatus: z.enum(["submitted", "approved", "rejected", "paid"]), expectedVersion: z.number().int().min(1), idempotencyKey: z.string().trim().min(8).max(120), rejectionReason: z.string().trim().max(2000).nullable().optional() });
async function payloadHash(value: unknown): Promise<string> { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))); return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function GET(request: Request) {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "doctor", "specialist"]);
  if (!access.ok) return access.response;
  const { db, tenantId, session } = access.context;
  const type = new URL(request.url).searchParams.get("type") ?? "contracts";
  if (type === "claim_audit" || type === "claim_events") {
    try {
    const searchParams = new URL(request.url).searchParams;
    const claimId = searchParams.get("claimId");
    if (!claimId || !uuidSchema.safeParse(claimId).success) throw new ApiError("المطالبة غير موجودة", 404);
    const [claim] = await db.select({ invoiceId: insuranceClaims.invoiceId }).from(insuranceClaims).where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.tenantId, tenantId))).limit(1);
    if (!claim) throw new ApiError("المطالبة غير موجودة", 404);
    const [invoice] = await db.select({ branchId: invoices.branchId }).from(invoices).where(and(eq(invoices.id, claim.invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!invoice) throw new ApiError("الفاتورة المرتبطة بالمطالبة غير موجودة", 404);
    await requireBranchMembership(access.context, invoice.branchId);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25") || 25));
    const eventWhere = and(eq(insuranceClaimEvents.tenantId, tenantId), eq(insuranceClaimEvents.claimId, claimId));
    const [{ total }] = await db.select({ total: count() }).from(insuranceClaimEvents).where(eventWhere);
    const rawEvents = await db.select({ id: insuranceClaimEvents.id, claimId: insuranceClaimEvents.claimId, version: insuranceClaimEvents.version, type: insuranceClaimEvents.type, fromStatus: insuranceClaimEvents.fromStatus, toStatus: insuranceClaimEvents.toStatus, actorId: insuranceClaimEvents.actorId, actorName: users.fullName, idempotencyKey: insuranceClaimEvents.idempotencyKey, metadataJson: insuranceClaimEvents.metadataJson, createdAt: insuranceClaimEvents.createdAt }).from(insuranceClaimEvents).leftJoin(users, and(eq(users.id, insuranceClaimEvents.actorId), eq(users.tenantId, tenantId))).where(eventWhere).orderBy(asc(insuranceClaimEvents.version), asc(insuranceClaimEvents.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const events = rawEvents.map(normalizeClaimEvent);
    return Response.json({ events, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return errorResponse(error); }
  }
  if (type === "contracts") return Response.json({ contracts: await db.select().from(insuranceContracts).where(and(eq(insuranceContracts.tenantId, tenantId), eq(insuranceContracts.isActive, true))).orderBy(asc(insuranceContracts.name)) });
  if (type === "templates") return Response.json({ templates: await db.select().from(prescriptionTemplates).where(and(eq(prescriptionTemplates.tenantId, tenantId), eq(prescriptionTemplates.practitionerId, session.sub), eq(prescriptionTemplates.isActive, true))).orderBy(desc(prescriptionTemplates.createdAt)) });
  if (type === "claims") {
    const month = new URL(request.url).searchParams.get("month");
    const accessibleBranchIds = await getAccessibleBranchIds(access.context);
    if (!accessibleBranchIds.length) return Response.json({ claims: [] }, { headers: { "Cache-Control": "no-store" } });
    const rows = await db.select({ claim: insuranceClaims, contractName: insuranceContracts.name, patientName: customers.fullName, invoiceNumber: invoices.invoiceNumber }).from(insuranceClaims).innerJoin(insuranceContracts, and(eq(insuranceContracts.id, insuranceClaims.contractId), eq(insuranceContracts.tenantId, tenantId))).innerJoin(customers, and(eq(customers.id, insuranceClaims.customerId), eq(customers.tenantId, tenantId))).innerJoin(invoices, and(eq(invoices.id, insuranceClaims.invoiceId), eq(invoices.tenantId, tenantId))).where(and(eq(insuranceClaims.tenantId, tenantId), inArray(invoices.branchId, accessibleBranchIds), month ? eq(insuranceClaims.claimMonth, month) : undefined)).orderBy(desc(insuranceClaims.createdAt));
    return Response.json({ claims: rows }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "نوع التقرير غير معروف" }, { status: 400 });
}

export async function POST(request: Request) {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "doctor", "specialist"]);
  if (!access.ok) return access.response;
  try {
    const body = await request.json() as { action?: string };
    const { db, tenantId, session, user } = access.context;
    if (body.action === "claim") {
      const input = claimSchema.parse(body);
      const hash = await payloadHash({ invoiceId: input.invoiceId, contractId: input.contractId, memberNumber: input.memberNumber ?? null, notes: input.notes ?? null });
      const [existingKey] = await db.select().from(insuranceClaims).where(and(eq(insuranceClaims.tenantId, tenantId), eq(insuranceClaims.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingKey) {
        if (existingKey.payloadHash !== hash) throw new ApiError("مفتاح التكرار مستخدم بطلب مختلف", 409);
        const [existingInvoice] = await db.select({ branchId: invoices.branchId }).from(invoices).where(and(eq(invoices.id, existingKey.invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
        if (!existingInvoice) throw new ApiError("الفاتورة المرتبطة بالمطالبة غير موجودة", 404);
        await requireBranchMembership(access.context, existingInvoice.branchId);
        return Response.json({ claim: existingKey, idempotent: true });
      }
      const [invoice] = await db.select({ id: invoices.id, customerId: invoices.customerId, branchId: invoices.branchId, insuranceContractId: invoices.insuranceContractId, totalMinor: invoices.totalMinor, insuranceGrossMinor: invoices.insuranceGrossMinor, insurancePatientDueMinor: invoices.insurancePatientDueMinor, insuranceClaimMinor: invoices.insuranceClaimMinor, insuranceMemberNumber: invoices.insuranceMemberNumber, createdAt: invoices.createdAt }).from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
      if (!invoice?.customerId) throw new ApiError("الفاتورة أو العميل غير موجود", 404);
      await requireBranchMembership(access.context, invoice.branchId);
      if (!invoice.insuranceContractId || invoice.insuranceContractId !== input.contractId) throw new ApiError("لا تتطابق المطالبة مع عقد التأمين المسجل على الفاتورة", 409);
      const [contract] = await db.select().from(insuranceContracts).where(and(eq(insuranceContracts.id, input.contractId), eq(insuranceContracts.tenantId, tenantId), eq(insuranceContracts.isActive, true))).limit(1);
      if (!contract) throw new ApiError("عقد التأمين غير موجود أو غير نشط", 404);
      const claimMinor = invoice.insuranceClaimMinor;
      if (claimMinor <= 0) throw new ApiError("الفاتورة لا تحتوي على مبلغ مطالبة تأمينية", 409);
      const now = new Date();
      const claimId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const auditId = crypto.randomUUID();
      await db.batch([
        db.insert(insuranceClaims).values({ id: claimId, tenantId, contractId: contract.id, invoiceId: invoice.id, customerId: invoice.customerId, claimMonth: invoice.createdAt.toISOString().slice(0, 7), grossMinor: invoice.insuranceGrossMinor, patientDueMinor: invoice.insurancePatientDueMinor, claimMinor, memberNumber: input.memberNumber ?? invoice.insuranceMemberNumber ?? null, status: "open", version: 1, idempotencyKey: input.idempotencyKey, payloadHash: hash, rejectionReason: null, notes: input.notes ?? null, createdAt: now, updatedAt: now }),
        db.insert(insuranceClaimEvents).values({ id: eventId, tenantId, claimId, version: 1, type: "created", fromStatus: null, toStatus: "open", actorId: user.id, idempotencyKey: claimCreationEventKey(input.idempotencyKey), payloadHash: hash, metadataJson: JSON.stringify({ status: "open" }), createdAt: now }),
        db.insert(auditLogs).values({ id: auditId, tenantId, actorId: user.id, action: "medical.insurance_claim.created", resourceType: "insurance_claim", resourceId: claimId, ipAddress: null, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null, metadataJson: JSON.stringify({ status: "open", eventId }), createdAt: now }),
      ]);
      const [claim] = await db.select().from(insuranceClaims).where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.tenantId, tenantId))).limit(1);
      return Response.json({ claim }, { status: 201 });
    }
    if (body.action === "contract") {
      const input = contractSchema.parse(body); const id = crypto.randomUUID();
      const [row] = await db.insert(insuranceContracts).values({ id, tenantId, name: input.name, contractType: input.contractType, discountBps: Math.round(input.discountPercent * 100), copayBps: Math.round(input.copayPercent * 100), memberNumberLabel: input.memberNumberLabel, isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
      await writeAudit(access.context, request, "medical.insurance_contract.created", "insurance_contract", id);
      return Response.json({ contract: row }, { status: 201 });
    }
    if (body.action === "template") {
      if (!isClinicalRole(session.role)) throw new ApiError("يمكن للطبيب أو الأخصائي إدارة قوالب الروشتات", 403);
      const input = templateSchema.parse(body); const id = crypto.randomUUID();
      const [row] = await db.insert(prescriptionTemplates).values({ id, tenantId, practitionerId: user.id, name: input.name, itemsJson: JSON.stringify(input.items), isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
      await writeAudit(access.context, request, "clinical.prescription_template.created", "prescription_template", id);
      return Response.json({ template: row }, { status: 201 });
    }
    if (body.action === "lab") {
      if (!isClinicalRole(session.role)) throw new ApiError("طلبات التحاليل متاحة للطبيب أو الأخصائي", 403);
      const input = labSchema.parse(body); const [patient] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1); if (!patient) throw new ApiError("المريض غير موجود", 404);
      if (input.encounterId) { const [encounter] = await db.select({ id: clinicalEncounters.id, practitionerId: clinicalEncounters.practitionerId }).from(clinicalEncounters).where(and(eq(clinicalEncounters.id, input.encounterId), eq(clinicalEncounters.tenantId, tenantId), eq(clinicalEncounters.customerId, input.customerId))).limit(1); if (!encounter || encounter.practitionerId !== user.id) throw new ApiError("السجل السريري غير صالح", 403); }
      const id = crypto.randomUUID(); const [row] = await db.insert(labRequests).values({ id, tenantId, customerId: input.customerId, encounterId: input.encounterId ?? null, practitionerId: user.id, requestType: input.requestType, testsJson: JSON.stringify(input.tests), clinicalNotes: input.clinicalNotes ?? null, status: "requested", createdAt: new Date(), updatedAt: new Date() }).returning();
      await writeAudit(access.context, request, "clinical.lab_request.created", "lab_request", id);
      return Response.json({ request: row }, { status: 201 });
    }
    throw new ApiError("الإجراء الطبي غير معروف", 400);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "doctor", "specialist"]);
  if (!access.ok) return access.response;
  try {
    const input = claimTransitionSchema.parse(await request.json());
    const { db, tenantId, session, user } = access.context;
    const [claim] = await db.select().from(insuranceClaims).where(and(eq(insuranceClaims.id, input.claimId), eq(insuranceClaims.tenantId, tenantId))).limit(1);
    if (!claim) throw new ApiError("المطالبة غير موجودة", 404);
    const [invoice] = await db.select({ branchId: invoices.branchId }).from(invoices).where(and(eq(invoices.id, claim.invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!invoice) throw new ApiError("الفاتورة المرتبطة بالمطالبة غير موجودة", 404);
    await requireBranchMembership(access.context, invoice.branchId);
    if (!canPerformInsuranceClaimTransition(session.role, input.nextStatus as InsuranceClaimStatus)) throw new ApiError("اعتماد المطالبات وصرفها متاحان لمسؤولي الأعمال فقط", 403);
    const rejectionReason = input.nextStatus === "rejected" ? input.rejectionReason?.trim() || null : null;
    const transitionPayload = claimEventPayload({ claimId: claim.id, nextStatus: input.nextStatus as InsuranceClaimStatus, expectedVersion: input.expectedVersion, rejectionReason });
    const transitionHash = await payloadHash(transitionPayload);
    const eventKey = claimTransitionEventKey(claim.id, input.idempotencyKey);
    const [existingEvent] = await db.select().from(insuranceClaimEvents).where(and(eq(insuranceClaimEvents.tenantId, tenantId), eq(insuranceClaimEvents.idempotencyKey, eventKey))).limit(1);
    if (existingEvent) {
      if (existingEvent.payloadHash !== transitionHash) throw new ApiError("مفتاح التكرار مستخدم بطلب مختلف", 409);
      const [currentClaim] = await db.select().from(insuranceClaims).where(and(eq(insuranceClaims.id, claim.id), eq(insuranceClaims.tenantId, tenantId))).limit(1);
      return Response.json({ claim: currentClaim, event: normalizeClaimEvent({ ...existingEvent, actorName: null })!, idempotent: true });
    }
    try { assertExpectedVersion(claim.version, input.expectedVersion); assertInsuranceClaimTransition(claim.status as InsuranceClaimStatus, input.nextStatus as InsuranceClaimStatus); } catch (error) { if (String(error).includes("VERSION_CONFLICT")) throw new ApiError("تغيّرت المطالبة؛ أعد تحميلها قبل الحفظ", 409); throw new ApiError("انتقال حالة المطالبة غير مسموح", 409); }
    if (input.nextStatus === "rejected" && !rejectionReason) throw new ApiError("سبب رفض المطالبة مطلوب", 400);
    const now = new Date();
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const results = await access.context.env.DB.batch([
      access.context.env.DB.prepare("UPDATE insurance_claims SET status = ?, version = version + 1, rejection_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND version = ? AND status = ?").bind(input.nextStatus, rejectionReason, now.getTime(), claim.id, tenantId, input.expectedVersion, claim.status),
      access.context.env.DB.prepare("INSERT INTO insurance_claim_events (id, tenant_id, claim_id, version, type, from_status, to_status, actor_id, idempotency_key, payload_hash, metadata_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(eventId, tenantId, claim.id, claim.version + 1, "status_transition", claim.status, input.nextStatus, user.id, eventKey, transitionHash, JSON.stringify({ fromStatus: claim.status, toStatus: input.nextStatus, rejectionReason }), now.getTime()),
      access.context.env.DB.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(auditId, tenantId, user.id, `medical.insurance_claim.${input.nextStatus}`, "insurance_claim", claim.id, null, request.headers.get("user-agent")?.slice(0, 300) ?? null, JSON.stringify({ fromStatus: claim.status, toStatus: input.nextStatus, eventId }), now.getTime()),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1 || (results[2]?.meta?.changes ?? 0) !== 1) throw new ApiError("تغيّرت المطالبة؛ أعد تحميلها قبل الحفظ", 409);
    const [updated] = await db.select().from(insuranceClaims).where(and(eq(insuranceClaims.id, claim.id), eq(insuranceClaims.tenantId, tenantId), eq(insuranceClaims.version, claim.version + 1))).limit(1);
    if (!updated) throw new ApiError("تغيّرت المطالبة؛ أعد تحميلها قبل الحفظ", 409);
    return Response.json({ claim: updated });
  } catch (error) { return errorResponse(error); }
}
