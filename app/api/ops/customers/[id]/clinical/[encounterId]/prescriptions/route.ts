import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, clinicalEncounters, clinicalPrescriptions, inventoryItems, inventoryWarehouses, prescriptionDispenses } from "@/lib/db/schema";
import { isBusinessAdminRole, isClinicalRole } from "@/lib/operations/permissions";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { uuidSchema } from "@/lib/operations/validation";
import { getCustomerBranchScope, requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";
import { quantityToUnits } from "@/lib/operations/inventory";
import { assertExpectedVersion } from "@/lib/operations/medical-contracts";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string; encounterId: string }> };
const prescriptionSchema = z.object({
  medicineName: z.string().trim().min(1).max(160),
  dose: z.string().trim().min(1).max(80),
  doseUnit: z.string().trim().min(1).max(40),
  frequency: z.string().trim().min(1).max(120),
  duration: z.string().trim().min(1).max(40),
  durationUnit: z.string().trim().min(1).max(40),
  route: z.string().trim().min(1).max(80),
  warnings: z.string().trim().max(2000).default(""),
  patientInstructions: z.string().trim().max(4000).default(""),
  inventoryItemId: uuidSchema.nullable().optional(),
  warehouseId: uuidSchema.nullable().optional(),
  dispenseQuantity: z.number().finite().gt(0).max(1_000_000).nullable().optional(),
});
const patchSchema = z.object({
  prescriptionId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  action: z.enum(["update", "cancel"]),
  medicineName: z.string().trim().min(1).max(160).optional(), dose: z.string().trim().min(1).max(80).optional(), doseUnit: z.string().trim().min(1).max(40).optional(), frequency: z.string().trim().min(1).max(120).optional(), duration: z.string().trim().min(1).max(40).optional(), durationUnit: z.string().trim().min(1).max(40).optional(), route: z.string().trim().min(1).max(80).optional(), warnings: z.string().trim().max(2000).optional(), patientInstructions: z.string().trim().max(4000).optional(), cancellationReason: z.string().trim().min(3).max(2000).nullable().optional(),
}).strict();

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId, encounterId } = await route.params;
    if (!uuidSchema.safeParse(customerId).success || !uuidSchema.safeParse(encounterId).success) throw new ApiError("معرف السجل أو المريض غير صالح");
    const parsed = prescriptionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من حقول الوصفة المنظمة");
    const { db, tenantId, session, user } = access.context;
    const scope = await getCustomerBranchScope(access.context, customerId);
    const [encounter] = await db.select().from(clinicalEncounters).where(and(eq(clinicalEncounters.id, encounterId), eq(clinicalEncounters.tenantId, tenantId), eq(clinicalEncounters.customerId, customerId))).limit(1);
    if (!encounter) throw new ApiError("السجل السريري غير موجود", 404);
    let clinicBranchId = scope.customerBranchId;
    if (encounter.appointmentId) {
      if (!scope.appointmentIds.includes(encounter.appointmentId)) throw new ApiError("لا تملك عضوية الفرع المرتبط بهذا السجل", 403);
      const [appointment] = await db.select({ branchId: appointments.branchId }).from(appointments).where(and(eq(appointments.id, encounter.appointmentId), eq(appointments.tenantId, tenantId))).limit(1);
      await requireBranchMembership(access.context, appointment?.branchId);
      clinicBranchId = appointment?.branchId ?? null;
    } else if (!scope.customerBranchId || !scope.accessibleBranchIds.includes(scope.customerBranchId)) {
      throw new ApiError("لا تملك عضوية الفرع المرتبط بهذا السجل", 403);
    }
    if (isClinicalRole(session.role) && encounter.practitionerId !== session.sub) throw new ApiError("لا تملك صلاحية تعديل هذا السجل", 403);
    if (isBusinessAdminRole(session.role) && encounter.appointmentId) {
      const [appointment] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, encounter.appointmentId), eq(appointments.tenantId, tenantId), eq(appointments.customerId, customerId))).limit(1);
      if (!appointment) throw new ApiError("الموعد المرتبط بالسجل غير موجود", 409);
    }
    const itemId = parsed.data.inventoryItemId ?? null;
    const warehouseId = parsed.data.warehouseId ?? null;
    const requestedQuantity = parsed.data.dispenseQuantity ?? null;
    const hasInventoryLink = itemId !== null || warehouseId !== null || requestedQuantity !== null;
    if (hasInventoryLink && (!itemId || !warehouseId || requestedQuantity === null)) throw new ApiError("لربط الروشتة بالمخزون، اختر الصنف والمخزن والكمية معًا");
    let inventoryLink: { inventoryItemId: string | null; warehouseId: string | null; dispenseQuantity: number | null; dispenseQuantityScale: number | null } = { inventoryItemId: null, warehouseId: null, dispenseQuantity: null, dispenseQuantityScale: null };
    if (itemId && warehouseId && requestedQuantity !== null) {
      const [item] = await db.select({ id: inventoryItems.id, quantityScale: inventoryItems.quantityScale, sellingPriceMinor: inventoryItems.sellingPriceMinor, isActive: inventoryItems.isActive }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId))).limit(1);
      if (!item?.isActive || item.sellingPriceMinor < 1) throw new ApiError("الصنف غير نشط أو لم يُحدد له سعر بيع", 409);
      const [warehouse] = await db.select({ id: inventoryWarehouses.id, branchId: inventoryWarehouses.branchId, isActive: inventoryWarehouses.isActive }).from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, warehouseId), eq(inventoryWarehouses.tenantId, tenantId))).limit(1);
      if (!warehouse?.isActive) throw new ApiError("المخزن غير موجود أو غير نشط", 409);
      if (!clinicBranchId || (warehouse.branchId && warehouse.branchId !== clinicBranchId)) throw new ApiError("يجب اختيار مخزن يتبع فرع العيادة", 409);
      await requireWarehouseBranchMembership(access.context, warehouse.branchId);
      inventoryLink = { inventoryItemId: item.id, warehouseId: warehouse.id, dispenseQuantity: quantityToUnits(requestedQuantity, item.quantityScale), dispenseQuantityScale: item.quantityScale };
    }
    const id = crypto.randomUUID();
    const prescriptionFields = { ...parsed.data };
    delete prescriptionFields.dispenseQuantity;
    delete prescriptionFields.inventoryItemId;
    delete prescriptionFields.warehouseId;
    const [prescription] = await db.insert(clinicalPrescriptions).values({ id, tenantId, encounterId, customerId, authorId: user.id, ...prescriptionFields, ...inventoryLink, status: "active", createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, "clinical.prescription.created", "clinical_prescription", id, { customerId, encounterId, linkedToInventory: Boolean(inventoryLink.inventoryItemId), drugInteractionChecking: false });
    return Response.json({ prescription, policy: { drugInteractionChecking: false } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}


export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId, encounterId } = await route.params;
    const input = patchSchema.parse(await request.json());
    const { db, tenantId, session } = access.context;
    const [prescription] = await db.select().from(clinicalPrescriptions).where(and(eq(clinicalPrescriptions.id, input.prescriptionId), eq(clinicalPrescriptions.tenantId, tenantId), eq(clinicalPrescriptions.customerId, customerId), eq(clinicalPrescriptions.encounterId, encounterId))).limit(1);
    if (!prescription) throw new ApiError("الروشتة غير موجودة", 404);
    const [encounter] = await db.select({ practitionerId: clinicalEncounters.practitionerId }).from(clinicalEncounters).where(and(eq(clinicalEncounters.id, encounterId), eq(clinicalEncounters.tenantId, tenantId), eq(clinicalEncounters.customerId, customerId))).limit(1);
    if (!encounter) throw new ApiError("السجل السريري غير موجود", 404);
    if (isClinicalRole(session.role) && encounter.practitionerId !== session.sub) throw new ApiError("لا تملك صلاحية تعديل هذه الروشتة", 403);
    try { assertExpectedVersion(prescription.version, input.expectedVersion); } catch { throw new ApiError("تغيّرت الروشتة؛ أعد تحميلها قبل الحفظ", 409); }
    const [dispense] = await db.select({ id: prescriptionDispenses.id }).from(prescriptionDispenses).where(and(eq(prescriptionDispenses.tenantId, tenantId), eq(prescriptionDispenses.prescriptionId, prescription.id))).limit(1);
    if (dispense) throw new ApiError("لا يمكن تعديل أو إلغاء روشتة تم صرفها", 409);
    if (input.action === "cancel") {
      if (prescription.status === "cancelled") throw new ApiError("الروشتة ملغاة بالفعل", 409);
      if (!input.cancellationReason?.trim()) throw new ApiError("سبب إلغاء الروشتة مطلوب", 400);
      const [updated] = await db.update(clinicalPrescriptions).set({ status: "cancelled", version: prescription.version + 1, cancellationReason: input.cancellationReason.trim(), cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(clinicalPrescriptions.id, prescription.id), eq(clinicalPrescriptions.version, input.expectedVersion), eq(clinicalPrescriptions.status, "active"))).returning();
      if (!updated) throw new ApiError("تغيّرت الروشتة؛ أعد تحميلها قبل الحفظ", 409);
      await writeAudit(access.context, request, "clinical.prescription.cancelled", "clinical_prescription", prescription.id, { version: updated.version });
      return Response.json({ prescription: updated });
    }
    if (prescription.status !== "active") throw new ApiError("لا يمكن تعديل روشتة غير نشطة", 409);
    const [updated] = await db.update(clinicalPrescriptions).set({
      medicineName: input.medicineName ?? prescription.medicineName, dose: input.dose ?? prescription.dose, doseUnit: input.doseUnit ?? prescription.doseUnit, frequency: input.frequency ?? prescription.frequency, duration: input.duration ?? prescription.duration, durationUnit: input.durationUnit ?? prescription.durationUnit, route: input.route ?? prescription.route, warnings: input.warnings ?? prescription.warnings, patientInstructions: input.patientInstructions ?? prescription.patientInstructions, version: prescription.version + 1, updatedAt: new Date(),
    }).where(and(eq(clinicalPrescriptions.id, prescription.id), eq(clinicalPrescriptions.version, input.expectedVersion), eq(clinicalPrescriptions.status, "active"))).returning();
    if (!updated) throw new ApiError("تغيّرت الروشتة؛ أعد تحميلها قبل الحفظ", 409);
    await writeAudit(access.context, request, "clinical.prescription.updated", "clinical_prescription", prescription.id, { version: updated.version });
    return Response.json({ prescription: updated });
  } catch (error) { return errorResponse(error); }
}
