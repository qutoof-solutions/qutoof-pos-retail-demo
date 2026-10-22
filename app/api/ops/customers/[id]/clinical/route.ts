import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { appointments, clinicalEncounters, clinicalPrescriptions, customers, invoices, prescriptionDispenses, users } from "@/lib/db/schema";
import { isClinicalRole } from "@/lib/operations/permissions";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { uuidSchema } from "@/lib/operations/validation";
import { getCustomerBranchScope, requireBranchMembership } from "@/lib/server/branch-access";
import { assertExpectedVersion } from "@/lib/operations/medical-contracts";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };

const vitalSchema = z.record(z.string().trim().min(1).max(40), z.string().trim().max(80)).default({});
const problemSchema = z.object({ name: z.string().trim().min(1).max(160), status: z.enum(["active", "resolved", "historical"]).default("active"), notes: z.string().trim().max(1000).optional() });
const encounterSchema = z.object({
  appointmentId: uuidSchema.nullable().optional(),
  practitionerId: uuidSchema.nullable().optional(),
  vitals: vitalSchema,
  allergies: z.string().trim().max(4000).default(""),
  problems: z.array(problemSchema).max(50).default([]),
  assessment: z.string().trim().min(1).max(12000),
  plan: z.string().trim().min(1).max(12000),
  followUp: z.string().trim().max(4000).nullable().optional(),
});
const encounterUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  vitals: vitalSchema.optional(), allergies: z.string().trim().max(4000).optional(), problems: z.array(problemSchema).max(50).optional(),
  assessment: z.string().trim().min(1).max(12000).optional(), plan: z.string().trim().min(1).max(12000).optional(), followUp: z.string().trim().max(4000).nullable().optional(),
}).strict();

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  const { id: customerId } = await route.params;
  if (!uuidSchema.safeParse(customerId).success) return Response.json({ error: "معرف المريض غير صالح" }, { status: 400 });
  const { db, tenantId, session } = access.context;
  let scope;
  try { scope = await getCustomerBranchScope(access.context, customerId); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "لا تملك صلاحية الوصول إلى هذا الملف" }, { status: error instanceof Error && error.message === "المريض غير موجود" ? 404 : 403 }); }
  const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
  if (!customer) return Response.json({ error: "المريض غير موجود" }, { status: 404 });
  const encounters = await db.select({
    encounter: clinicalEncounters,
    practitionerName: users.fullName,
  }).from(clinicalEncounters)
    .leftJoin(users, and(eq(users.id, clinicalEncounters.practitionerId), eq(users.tenantId, tenantId)))
    .where(and(
      eq(clinicalEncounters.tenantId, tenantId),
      eq(clinicalEncounters.customerId, customerId),
      scope.customerBranchId && scope.accessibleBranchIds.includes(scope.customerBranchId)
        ? or(isNull(clinicalEncounters.appointmentId), scope.appointmentIds.length ? inArray(clinicalEncounters.appointmentId, scope.appointmentIds) : undefined)
        : scope.appointmentIds.length ? inArray(clinicalEncounters.appointmentId, scope.appointmentIds) : isNull(clinicalEncounters.appointmentId),
      ...(isClinicalRole(session.role) ? [eq(clinicalEncounters.practitionerId, session.sub)] : []),
    )).orderBy(asc(clinicalEncounters.createdAt));
  const ids = encounters.map(({ encounter }) => encounter.id);
  const scopedPrescriptions = ids.length
    ? await db.select().from(clinicalPrescriptions).where(and(eq(clinicalPrescriptions.tenantId, tenantId), inArray(clinicalPrescriptions.encounterId, ids)))
    : [];
  const dispenses = scopedPrescriptions.length
    ? await db.select({ prescriptionId: prescriptionDispenses.prescriptionId, invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber, dispensedAt: prescriptionDispenses.dispensedAt })
      .from(prescriptionDispenses)
      .innerJoin(invoices, and(eq(invoices.id, prescriptionDispenses.invoiceId), eq(invoices.tenantId, tenantId)))
      .where(and(eq(prescriptionDispenses.tenantId, tenantId), inArray(prescriptionDispenses.prescriptionId, scopedPrescriptions.map((item) => item.id))))
    : [];
  return Response.json({
    encounters: encounters.map(({ encounter, practitionerName }) => ({ ...encounter, practitionerName, prescriptions: scopedPrescriptions.filter((prescription) => prescription.encounterId === encounter.id).map((prescription) => {
      const dispense = dispenses.find((item) => item.prescriptionId === prescription.id);
      return { ...prescription, dispensedAt: dispense?.dispensedAt ?? null, dispenseInvoiceId: dispense?.invoiceId ?? null, dispenseInvoiceNumber: dispense?.invoiceNumber ?? null };
    }) })),
    policy: { drugInteractionChecking: false, automaticDeletion: false },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId } = await route.params;
    if (!uuidSchema.safeParse(customerId).success) throw new ApiError("معرف المريض غير صالح");
    const parsed = encounterSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من حقول السجل السريري المنظم");
    const input = parsed.data;
    const { db, tenantId, session, user } = access.context;
    const scope = await getCustomerBranchScope(access.context, customerId);
    const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
    if (!customer) throw new ApiError("المريض غير موجود", 404);

    const practitionerId = isClinicalRole(session.role) ? session.sub : input.practitionerId;
    if (!practitionerId) throw new ApiError("حدد الممارس المسؤول عن السجل");
    const [practitioner] = await db.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.id, practitionerId), eq(users.tenantId, tenantId), eq(users.isActive, true))).limit(1);
    if (!practitioner || !isClinicalRole(practitioner.role)) throw new ApiError("الممارس غير موجود أو ليس له دور سريري", 400);
    if (isClinicalRole(session.role) && input.appointmentId == null) throw new ApiError("يجب ربط السجل بموعد مسند للممارس", 400);
    if (input.appointmentId) {
      const [appointment] = await db.select({ id: appointments.id, providerId: appointments.providerId, branchId: appointments.branchId }).from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, tenantId), eq(appointments.customerId, customerId))).limit(1);
      if (!appointment || appointment.providerId !== practitionerId) throw new ApiError("الموعد لا يخص هذا المريض أو الممارس المحدد", 400);
      await requireBranchMembership(access.context, appointment.branchId);
    } else if (!scope.customerBranchId || !scope.accessibleBranchIds.includes(scope.customerBranchId)) {
      throw new ApiError("يجب ربط السجل بموعد في فرع مسند أو تحديد ملف تابع لفرع مسند", 400);
    }
    const id = crypto.randomUUID();
    const [encounter] = await db.insert(clinicalEncounters).values({
      id, tenantId, customerId, appointmentId: input.appointmentId ?? null, practitionerId, authorId: user.id,
      vitalsJson: JSON.stringify(input.vitals), allergiesText: input.allergies, problemsJson: JSON.stringify(input.problems),
      assessment: input.assessment, plan: input.plan, followUp: input.followUp ?? null, version: 1,
      createdAt: new Date(), updatedAt: new Date(),
    }).returning();
    await writeAudit(access.context, request, "clinical.encounter.created", "clinical_encounter", id, { customerId, appointmentId: input.appointmentId ?? null, practitionerId });
    return Response.json({ encounter }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}


export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId } = await route.params;
    const parsed = encounterUpdateSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من حقول تحديث السجل السريري");
    const { db, tenantId, session } = access.context;
    const encounterId = new URL(request.url).searchParams.get("encounterId");
    if (!encounterId || !uuidSchema.safeParse(encounterId).success || !uuidSchema.safeParse(customerId).success) throw new ApiError("معرف السجل أو المريض غير صالح");
    const [encounter] = await db.select().from(clinicalEncounters).where(and(eq(clinicalEncounters.id, encounterId), eq(clinicalEncounters.tenantId, tenantId), eq(clinicalEncounters.customerId, customerId))).limit(1);
    if (!encounter) throw new ApiError("السجل السريري غير موجود", 404);
    if (isClinicalRole(session.role) && encounter.practitionerId !== session.sub) throw new ApiError("لا تملك صلاحية تعديل هذا السجل", 403);
    try { assertExpectedVersion(encounter.version, parsed.data.expectedVersion); } catch { throw new ApiError("تغيّر السجل السريري؛ أعد تحميله قبل الحفظ", 409); }
    const input = parsed.data;
    const [updated] = await db.update(clinicalEncounters).set({
      vitalsJson: input.vitals === undefined ? encounter.vitalsJson : JSON.stringify(input.vitals),
      allergiesText: input.allergies === undefined ? encounter.allergiesText : input.allergies,
      problemsJson: input.problems === undefined ? encounter.problemsJson : JSON.stringify(input.problems),
      assessment: input.assessment === undefined ? encounter.assessment : input.assessment,
      plan: input.plan === undefined ? encounter.plan : input.plan,
      followUp: input.followUp === undefined ? encounter.followUp : input.followUp,
      version: encounter.version + 1, updatedAt: new Date(),
    }).where(and(eq(clinicalEncounters.id, encounter.id), eq(clinicalEncounters.tenantId, tenantId), eq(clinicalEncounters.version, parsed.data.expectedVersion))).returning();
    if (!updated) throw new ApiError("تغيّر السجل السريري؛ أعد تحميله قبل الحفظ", 409);
    await writeAudit(access.context, request, "clinical.encounter.updated", "clinical_encounter", encounter.id, { version: updated.version });
    return Response.json({ encounter: updated }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
