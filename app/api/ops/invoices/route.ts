import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { appointments, auditLogs, branchMemberships, branches, clinicalEncounters, clinicalPrescriptions, customerEntitlements, customers, distributionTripInvoices, distributionTrips, installmentContracts, installmentSchedules, insuranceClaimEvents, inventoryBalances, invoiceItems, invoicePayments, invoices, loyaltyAccounts, loyaltyTransactions, offlineStockConflicts, prescriptionDispenses, quotationItems, quotations, salesReps, services, stockMovements, insuranceContracts, insuranceClaims, stockOperations, users } from "@/lib/db/schema";
import { allocateStock, allocateStockForOfflineSale, quantityToUnits, unitsToQuantity, type InventoryItemRow, type StockAllocation } from "@/lib/operations/inventory";
import { moneySchema, paymentMethodSchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { payloadFingerprint } from "@/lib/operations/idempotency";
import { verifyOfflinePrice } from "@/lib/operations/offline-price";
import { getAccessibleBranchIds, requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";
import { isClinicalRole } from "@/lib/operations/permissions";
import { summarizePayments } from "@/lib/operations/payment-summary";
import { buildInstallmentPlan } from "@/lib/operations/installments";
import { discountMinorForPoints, pointsEarnedForPurchase } from "@/lib/operations/loyalty";
import { applyInvoicePayment } from "@/lib/operations/invoice-payment";
import { claimCreationEventKey } from "@/lib/operations/medical-claims";

export const runtime = "edge";
const offlinePriceSchema = z.object({ unitId: uuidSchema.nullable().optional(), unitPriceMinor: z.number().int().min(1).max(1_000_000_000), token: z.string().min(20).max(2048) });
const serviceLineSchema = z.object({ type: z.literal("service").default("service"), serviceId: uuidSchema, providerId: uuidSchema.nullable().default(null), quantity: z.number().int().min(1).max(100), offlinePrice: offlinePriceSchema.optional(), quotationItemId: uuidSchema.optional() });
const inventoryLineSchema = z.object({ type: z.literal("inventory"), inventoryItemId: uuidSchema, warehouseId: uuidSchema, unitId: uuidSchema.optional(), quantity: z.number().finite().gt(0).max(1_000_000), priceTier: z.enum(["retail", "wholesale", "distributor"]).default("retail"), offlinePrice: offlinePriceSchema.optional(), quotationItemId: uuidSchema.optional() });
const offlineSyncSchema = z.object({ localInvoiceId: uuidSchema, localInvoiceNumber: z.string().trim().regex(/^OFF-[A-Z0-9]{10}-\d{7,}$/u), createdAt: z.string().datetime() }).optional();
const installmentInput = z.object({ downPayment: moneySchema.max(10_000_000).default(0), interestBps: z.number().int().min(0).max(100_000).default(0), adminFee: moneySchema.max(10_000_000).default(0), installmentCount: z.number().int().min(1).max(60), frequency: z.enum(["weekly", "monthly"]), firstDueDate: z.string().date(), notes: z.string().trim().max(1000).nullable().optional() });
const invoiceInput = z.object({ quotationId: uuidSchema.optional(), distributionTripId: uuidSchema.optional(), idempotencyKey: z.string().trim().min(8).max(120), branchId: uuidSchema, customerId: uuidSchema, appointmentId: uuidSchema.nullable().optional(), insuranceContractId: uuidSchema.nullable().optional(), insuranceMemberNumber: z.string().trim().max(120).nullable().optional(), prescriptionIds: z.array(uuidSchema).min(1).max(40).optional(), discount: moneySchema.max(10_000_000).default(0), redeemPoints: z.number().int().nonnegative().max(1_000_000).default(0), items: z.array(z.union([serviceLineSchema, inventoryLineSchema])).max(40).default([]), payments: z.array(z.object({ amount: z.number().finite().gt(0).max(10_000_000), method: paymentMethodSchema, reference: z.string().trim().max(160).nullable().optional() })).max(8).default([]), installment: installmentInput.optional(), orderType: z.enum(["counter", "dine_in", "pickup", "delivery"]).default("counter"), deliveryCustomerName: z.string().trim().min(2).max(120).nullable().optional(), deliveryAddress: z.string().trim().min(4).max(500).nullable().optional(), deliveryPhone: z.string().trim().min(5).max(40).nullable().optional(), courierName: z.string().trim().max(120).nullable().optional(), offlineSync: offlineSyncSchema }).superRefine((row, context) => {
  if (row.quotationId) {
    const ids = new Set<string>();
    row.items.forEach((item, index) => {
      if (!item.quotationItemId) context.addIssue({ code: "custom", message: "كل بند تحويل يجب أن يشير إلى بند عرض السعر", path: ["items", index, "quotationItemId"] });
      else if (ids.has(item.quotationItemId)) context.addIssue({ code: "custom", message: "لا يمكن تكرار بند عرض السعر", path: ["items", index, "quotationItemId"] });
      else ids.add(item.quotationItemId);
    });
    if (row.offlineSync || row.prescriptionIds?.length) context.addIssue({ code: "custom", message: "لا يمكن جمع تحويل عرض السعر مع الصرف السريري أو مزامنة الأوفلاين", path: ["quotationId"] });
  } else if (row.items.some((item) => item.quotationItemId)) context.addIssue({ code: "custom", message: "معرف بند العرض لا يقبل دون معرف عرض السعر", path: ["items"] });
  if (row.installment && (row.offlineSync || row.quotationId || row.prescriptionIds?.length)) context.addIssue({ code: "custom", message: "التقسيط لا يعمل مع المزامنة أو تحويل عرض السعر أو صرف الروشتة", path: ["installment"] });
  if (row.redeemPoints > 0 && (row.offlineSync || row.quotationId || row.prescriptionIds?.length || row.installment)) context.addIssue({ code: "custom", message: "استبدال النقاط لا يعمل مع المزامنة أو التقسيط أو تحويل عرض السعر", path: ["redeemPoints"] });
  if (row.distributionTripId && (row.offlineSync || row.quotationId || row.prescriptionIds?.length || row.installment)) context.addIssue({ code: "custom", message: "مبيعات الرحلة تتطلب فاتورة POS مباشرة متصلة بالإنترنت", path: ["distributionTripId"] });
  if (row.orderType === "delivery") {
    if (!row.deliveryCustomerName) context.addIssue({ code: "custom", message: "اسم مستلم التوصيل مطلوب", path: ["deliveryCustomerName"] });
    if (!row.deliveryAddress) context.addIssue({ code: "custom", message: "عنوان التوصيل مطلوب", path: ["deliveryAddress"] });
    if (!row.deliveryPhone) context.addIssue({ code: "custom", message: "رقم هاتف التوصيل مطلوب", path: ["deliveryPhone"] });
  }
});

type InvoiceItemInsert = Omit<typeof invoiceItems.$inferInsert, "invoiceId">;
type ProductRow = InventoryItemRow & { selling_price_minor: number; wholesale_price_minor: number; distributor_price_minor: number; is_active: number };
type ProductDeduction = { item: InventoryItemRow; warehouseId: string; allocations: StockAllocation[]; requestedQuantity: number; availableQuantity: number; shortage: number };
type PendingProductDeduction = { item: InventoryItemRow; warehouseId: string; quantity: number };

async function invoiceResponse(db: ReturnType<typeof import("@/lib/db/client").getDb>, tenantId: string, id: string) {
  const [invoice] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, offlineLocalNumber: invoices.offlineLocalNumber, offlineCreatedAt: invoices.offlineCreatedAt, syncStatus: invoices.syncStatus, customerId: invoices.customerId, customerName: customers.fullName, customerPhone: customers.phone, branchId: invoices.branchId, subtotalMinor: invoices.subtotalMinor, discountMinor: invoices.discountMinor, installmentFeeMinor: invoices.installmentFeeMinor, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, paymentMethod: invoices.paymentMethod, status: invoices.status, orderType: invoices.orderType, deliveryCustomerName: invoices.deliveryCustomerName, deliveryAddress: invoices.deliveryAddress, deliveryPhone: invoices.deliveryPhone, courierName: invoices.courierName, deliveryStatus: invoices.deliveryStatus, createdAt: invoices.createdAt }).from(invoices).leftJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.tenantId, tenantId))).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).limit(1);  if (!invoice) return null;
  const [items, payments] = await Promise.all([
    db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.invoiceId, id))).orderBy(asc(invoiceItems.createdAt)),
    db.select().from(invoicePayments).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id))).orderBy(asc(invoicePayments.createdAt)),
  ]);
  return { ...invoice, items, payments };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  const filters = [eq(invoices.tenantId, access.context.tenantId)];
  const accessibleBranchIds = await getAccessibleBranchIds(access.context);
  if (!accessibleBranchIds.length) return Response.json({ invoices: [] }, { headers: { "Cache-Control": "no-store" } });
  if (branchId) {
    if (!uuidSchema.safeParse(branchId).success) return Response.json({ error: "معرف الفرع غير صالح" }, { status: 400 });
    await requireBranchMembership(access.context, branchId);
    filters.push(eq(invoices.branchId, branchId));
  } else filters.push(inArray(invoices.branchId, accessibleBranchIds));
  const rows = await access.context.db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, offlineLocalNumber: invoices.offlineLocalNumber, offlineCreatedAt: invoices.offlineCreatedAt, syncStatus: invoices.syncStatus, customerId: invoices.customerId, customerName: customers.fullName, customerPhone: customers.phone, branchId: invoices.branchId, subtotalMinor: invoices.subtotalMinor, discountMinor: invoices.discountMinor, installmentFeeMinor: invoices.installmentFeeMinor, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, paymentMethod: invoices.paymentMethod, status: invoices.status, orderType: invoices.orderType, deliveryCustomerName: invoices.deliveryCustomerName, deliveryAddress: invoices.deliveryAddress, deliveryPhone: invoices.deliveryPhone, courierName: invoices.courierName, deliveryStatus: invoices.deliveryStatus, createdAt: invoices.createdAt }).from(invoices).leftJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.tenantId, access.context.tenantId))).where(and(...filters)).orderBy(desc(invoices.createdAt)).limit(100);  const ids = rows.map((row) => row.id);
  const [items, payments] = ids.length ? await Promise.all([
    access.context.db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, access.context.tenantId), inArray(invoiceItems.invoiceId, ids))).orderBy(asc(invoiceItems.createdAt)),
    access.context.db.select().from(invoicePayments).where(and(eq(invoicePayments.tenantId, access.context.tenantId), inArray(invoicePayments.invoiceId, ids))).orderBy(asc(invoicePayments.createdAt)),
  ]) : [[], []];
  return Response.json({ invoices: rows.map((invoice) => ({ ...invoice, items: items.filter((item) => item.invoiceId === invoice.id), payments: payments.filter((payment) => payment.invoiceId === invoice.id) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  let requestKey = "";
  let requestHash = "";
  let offlineSyncRequested = false;
  try {
    const parsed = invoiceInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات الفاتورة وبنودها");
    const input = parsed.data;
    const isPrescriptionDispense = Boolean(input.prescriptionIds?.length);
    let distributionTrip: typeof distributionTrips.$inferSelect | null = null;
    if (!input.items.length && !isPrescriptionDispense) throw new ApiError("أضف بندًا واحدًا على الأقل للفاتورة");
    if (isPrescriptionDispense && input.items.length) throw new ApiError("صرف الروشتة يصدر بنودها المرتبطة بالمخزون فقط؛ لا ترسل بنودًا أخرى معها");
    if (isClinicalRole(access.context.session.role) && !isPrescriptionDispense) throw new ApiError("يمكن للطبيب إصدار فاتورة صرف من روشتة مرتبطة به فقط", 403);
    if (isPrescriptionDispense && (input.discount !== 0 || input.payments.length || input.offlineSync)) throw new ApiError("فاتورة صرف الروشتة تُنشأ بدون خصم أو دفعة مسبقة أو مزامنة أوفلاين");
    if (input.prescriptionIds && new Set(input.prescriptionIds).size !== input.prescriptionIds.length) throw new ApiError("قائمة الروشتات تحتوي تكرارًا");
    const isOfflineSync = Boolean(input.offlineSync);
    offlineSyncRequested = isOfflineSync;
    if (input.offlineSync && input.offlineSync.localInvoiceId !== input.idempotencyKey) throw new ApiError("معرف الفاتورة المحلية لا يطابق مفتاح منع التكرار", 400);
    if (isOfflineSync && input.items.some((line) => !line.offlinePrice)) throw new ApiError("بيانات سعر الكتالوج الموقعة غير موجودة؛ أعد تحميل الكتالوج ثم أعد المزامنة", 409);
    if (!isOfflineSync && input.items.some((line) => line.offlinePrice)) throw new ApiError("لا يمكن إرسال أسعار أوفلاين خارج طلب مزامنة معتمد", 400);
    await requireBranchMembership(access.context, input.branchId);
    requestKey = input.idempotencyKey;
    const normalizedHashItems = input.items.map((line) => {
      const { quotationItemId, ...base } = line;
      const item = line.type === "inventory" && line.priceTier !== "retail" ? { ...base, priceTier: line.priceTier } : base;
      return { ...item, ...(input.quotationId && quotationItemId ? { quotationItemId } : {}) };
    });
    const fingerprintPayload = { branchId: input.branchId, customerId: input.customerId, appointmentId: input.appointmentId ?? null, prescriptionIds: input.prescriptionIds ?? [], discount: input.discount, redeemPoints: input.redeemPoints, items: normalizedHashItems, payments: input.payments, ...(input.installment ? { installment: input.installment } : {}), ...(input.offlineSync ? { offlineSync: input.offlineSync } : {}), ...(input.distributionTripId ? { distributionTripId: input.distributionTripId } : {}), ...(input.orderType !== "counter" ? { orderType: input.orderType, deliveryCustomerName: input.deliveryCustomerName ?? null, deliveryAddress: input.deliveryAddress ?? null, deliveryPhone: input.deliveryPhone ?? null, courierName: input.courierName ?? null } : {}), ...(input.quotationId ? { quotationId: input.quotationId } : {}) };
    requestHash = await payloadFingerprint(fingerprintPayload);    const { db, tenantId } = access.context;
    const [existing] = await db.select({ id: invoices.id, payloadHash: invoices.idempotencyPayloadHash }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.idempotencyKey, requestKey))).limit(1);
    if (existing) {
      if (existing.payloadHash !== requestHash) throw new ApiError("مفتاح الفاتورة مستخدم لطلب مختلف؛ أنشئ عملية جديدة", 409);
      return Response.json({ invoice: await invoiceResponse(db, tenantId, existing.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    let quoteLineById = new Map<string, typeof quotationItems.$inferSelect>();
    if (input.quotationId) {
      if (input.idempotencyKey !== `quotation-convert:${input.quotationId}`) throw new ApiError("مفتاح التحويل غير صالح لهذا العرض", 409);
      const [quote] = await db.select().from(quotations).where(and(eq(quotations.id, input.quotationId), eq(quotations.tenantId, tenantId))).limit(1);
      if (!quote) throw new ApiError("عرض السعر غير موجود", 404);
      if (quote.status !== "issued" || (quote.validUntil && quote.validUntil.getTime() < Date.now())) throw new ApiError("عرض السعر غير صادر أو منتهي الصلاحية", 409);
      if (quote.branchId !== input.branchId || quote.customerId !== input.customerId || quote.discountMinor !== Math.round(input.discount * 100)) throw new ApiError("بيانات الفاتورة لا تطابق عرض السعر", 409);
      const quoteLines = await db.select().from(quotationItems).where(and(eq(quotationItems.tenantId, tenantId), eq(quotationItems.quotationId, quote.id)));
      if (quoteLines.length !== input.items.length || quote.subtotalMinor !== quoteLines.reduce((sum, line) => sum + line.lineTotalMinor, 0) || quote.totalMinor !== quote.subtotalMinor - quote.discountMinor) throw new ApiError("بيانات عرض السعر غير متسقة؛ أعد إنشاء العرض", 409);
      quoteLineById = new Map(quoteLines.map((line) => [line.id, line]));
      for (const line of input.items) {
        const quoteLine = quoteLineById.get(line.quotationItemId!);
        if (!quoteLine) throw new ApiError("بند الفاتورة لا يتبع عرض السعر", 409);
        if (line.type === "service") {
          if (quoteLine.serviceId !== line.serviceId || quoteLine.inventoryItemId || quoteLine.quantity !== line.quantity || quoteLine.quantityScale !== 0 || quoteLine.priceTier !== "retail") throw new ApiError("بند الخدمة لا يطابق عرض السعر", 409);
        } else {
          const requestedBaseQuantity = line.unitId ? Math.round(line.quantity * (quoteLine.unitConversionFactor ?? 1)) : quantityToUnits(line.quantity, quoteLine.quantityScale);
          if (quoteLine.serviceId || quoteLine.inventoryItemId !== line.inventoryItemId || quoteLine.warehouseId !== line.warehouseId || quoteLine.unitId !== (line.unitId ?? null) || quoteLine.priceTier !== line.priceTier || requestedBaseQuantity !== quoteLine.quantity) throw new ApiError("بند الصنف لا يطابق عرض السعر", 409);
        }
      }
    }
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط", 404);
    if (input.distributionTripId) {
      const [trip] = await db.select().from(distributionTrips).where(and(eq(distributionTrips.id, input.distributionTripId), eq(distributionTrips.tenantId, tenantId), eq(distributionTrips.branchId, input.branchId), eq(distributionTrips.status, "open"))).limit(1);
      const inventoryLines = input.items.filter((line) => line.type === "inventory");
      if (!trip || !inventoryLines.length || inventoryLines.some((line) => line.type !== "inventory" || line.warehouseId !== trip.vanWarehouseId)) throw new ApiError("رحلة التوزيع غير مفتوحة أو يجب أن تخصم جميع أصناف الفاتورة من مخزن سيارتها", 409);
      distributionTrip = trip;
    }
    const [customer] = await db.select({ id: customers.id, fullName: customers.fullName, phone: customers.phone, branchId: customers.branchId }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    if (customer.branchId !== input.branchId) {
      const [customerVisit] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, tenantId), eq(appointments.customerId, input.customerId), eq(appointments.branchId, input.branchId))).limit(1);
      if (!customerVisit) throw new ApiError("ملف العميل لا يملك علاقة مسجلة بهذا الفرع", 404);
    }
    if (input.appointmentId) {
      const [appointment] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, tenantId), eq(appointments.customerId, input.customerId), eq(appointments.branchId, input.branchId))).limit(1);
      if (!appointment) throw new ApiError("الموعد غير تابع لهذا العميل أو الفرع", 404);
    }
    const prescriptionRecords = isPrescriptionDispense ? await db.select({ prescription: clinicalPrescriptions, encounterId: clinicalEncounters.id, encounterCustomerId: clinicalEncounters.customerId, encounterAppointmentId: clinicalEncounters.appointmentId, practitionerId: clinicalEncounters.practitionerId, appointmentBranchId: appointments.branchId, appointmentProviderId: appointments.providerId, existingDispenseId: prescriptionDispenses.id })
      .from(clinicalPrescriptions)
      .innerJoin(clinicalEncounters, and(eq(clinicalEncounters.id, clinicalPrescriptions.encounterId), eq(clinicalEncounters.tenantId, tenantId)))
      .leftJoin(appointments, and(eq(appointments.id, clinicalEncounters.appointmentId), eq(appointments.tenantId, tenantId)))
      .leftJoin(prescriptionDispenses, and(eq(prescriptionDispenses.prescriptionId, clinicalPrescriptions.id), eq(prescriptionDispenses.tenantId, tenantId)))
      .where(and(eq(clinicalPrescriptions.tenantId, tenantId), inArray(clinicalPrescriptions.id, input.prescriptionIds!))) : [];
    if (isPrescriptionDispense) {
      if (prescriptionRecords.length !== input.prescriptionIds!.length) throw new ApiError("بعض الوصفات غير موجودة في مساحة العمل الحالية", 404);
      const firstEncounterId = prescriptionRecords[0]!.encounterId;
      for (const record of prescriptionRecords) {
        const prescription = record.prescription;
        if (record.encounterId !== firstEncounterId || record.encounterCustomerId !== input.customerId) throw new ApiError("يجب أن تكون الوصفات المختارة من لقاء واحد للمريض نفسه", 409);
        if (prescription.status !== "active") throw new ApiError("لا يمكن صرف وصفة ملغاة", 409);
        if (record.existingDispenseId) throw new ApiError("سبق صرف إحدى الوصفات؛ حدّث سجل المريض قبل إعادة المحاولة", 409);
        if (!prescription.inventoryItemId || !prescription.warehouseId || !prescription.dispenseQuantity || prescription.dispenseQuantityScale === null) throw new ApiError(`اربط وصفة «${prescription.medicineName}» بصنف ومخزن وكمية قبل الصرف`, 409);
        if ((record.encounterAppointmentId ?? null) !== (input.appointmentId ?? null)) throw new ApiError("الموعد المرتبط بفاتورة الصرف لا يطابق موعد اللقاء السريري", 409);
        if (record.appointmentBranchId && record.appointmentBranchId !== input.branchId) throw new ApiError("فرع الفاتورة لا يطابق فرع الموعد السريري", 409);
        if (isClinicalRole(access.context.session.role) && (record.practitionerId !== access.context.session.sub || (record.appointmentProviderId && record.appointmentProviderId !== access.context.session.sub))) throw new ApiError("يمكن للطبيب صرف وصفاته المرتبطة به فقط", 403);
      }
    }
    const invoiceLines: Array<{ line: z.infer<typeof serviceLineSchema> | z.infer<typeof inventoryLineSchema>; prescriptionId?: string }> = isPrescriptionDispense
      ? prescriptionRecords.map(({ prescription }) => ({ prescriptionId: prescription.id, line: { type: "inventory" as const, inventoryItemId: prescription.inventoryItemId!, warehouseId: prescription.warehouseId!, quantity: unitsToQuantity(prescription.dispenseQuantity!, prescription.dispenseQuantityScale!), priceTier: "retail" as const } }))
      : input.items.map((line) => ({ line }));
    const [followUpAppointment] = input.appointmentId ? await db.select({ id: appointments.id, customerId: appointments.customerId, followUpEligible: appointments.followUpEligible }).from(appointments).where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, tenantId), eq(appointments.customerId, input.customerId))).limit(1) : [];
    const isFreeFollowUp = Boolean(followUpAppointment?.followUpEligible);
    const itemRows: InvoiceItemInsert[] = [];
    const prescriptionItemRows = new Map<string, InvoiceItemInsert>();
    const entitlementSources: Array<{ invoiceItemId: string; serviceId: string; sessions: number; validityDays: number | null }> = [];
    const pendingProductDeductions: PendingProductDeduction[] = [];
    const productDeductions: ProductDeduction[] = [];
    let subtotalMinor = 0;
    for (const { line, prescriptionId } of invoiceLines) {
      const itemId = crypto.randomUUID();
      const quoteLine = input.quotationId ? quoteLineById.get(line.quotationItemId!) : undefined;
      if (line.type === "service") {
        const [service] = await db.select({ id: services.id, name: services.name, branchId: services.branchId, priceMinor: services.priceMinor, providerCommissionBps: services.providerCommissionBps, providerCommissionMode: services.providerCommissionMode, providerCommissionFixedMinor: services.providerCommissionFixedMinor, isActive: services.isActive, kind: services.kind, sessionCount: services.sessionCount, validityDays: services.validityDays }).from(services).where(and(eq(services.id, line.serviceId), eq(services.tenantId, tenantId))).limit(1);
        if (!service || (!isOfflineSync && !service.isActive) || (service.branchId && service.branchId !== input.branchId)) throw new ApiError("إحدى الخدمات غير متاحة في الفرع المحدد", 409);
        if (line.providerId) {
          const [provider] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, line.providerId), eq(users.tenantId, tenantId), inArray(users.role, ["provider", "doctor", "specialist"]), eq(users.isActive, true))).limit(1);
          if (!provider) throw new ApiError("مقدم الخدمة غير موجود", 404);
          const [membership] = await db.select({ id: branchMemberships.id }).from(branchMemberships).where(and(eq(branchMemberships.tenantId, tenantId), eq(branchMemberships.userId, line.providerId), eq(branchMemberships.branchId, input.branchId))).limit(1);
          if (!membership) throw new ApiError("مقدم الخدمة غير مسند إلى فرع الفاتورة", 403);
        }
        const unitPriceMinor = isFreeFollowUp ? 0 : quoteLine?.unitPriceMinor ?? (isOfflineSync ? line.offlinePrice!.unitPriceMinor : service.priceMinor);
        if (isOfflineSync && !await verifyOfflinePrice(access.context.env.SESSION_SECRET!, line.offlinePrice!.token, { tenantId, itemType: "service", itemId: service.id, branchId: input.branchId, unitPriceMinor })) throw new ApiError("توقيع سعر الخدمة غير صالح لهذا المستأجر أو الفرع", 409);
        const lineTotalMinor = unitPriceMinor * line.quantity;
        if (!Number.isSafeInteger(lineTotalMinor) || (quoteLine && quoteLine.lineTotalMinor !== lineTotalMinor)) throw new ApiError("قيمة بند الخدمة لا تطابق عرض السعر");
        subtotalMinor += lineTotalMinor;
        itemRows.push({ id: itemId, tenantId, serviceId: service.id, providerId: line.providerId, inventoryItemId: null, stockWarehouseId: null, quantityScale: 0, description: quoteLine?.description ?? service.name, quantity: line.quantity, unitPriceMinor, lineTotalMinor, signedPriceToken: line.offlinePrice?.token ?? null, commissionBps: service.providerCommissionBps, commissionMode: service.providerCommissionMode, commissionFixedMinor: service.providerCommissionFixedMinor, createdAt: new Date() });
        if (service.kind !== "single") entitlementSources.push({ invoiceItemId: itemId, serviceId: service.id, sessions: service.sessionCount * line.quantity, validityDays: service.validityDays });
      } else {
        const product = await access.context.env.DB.prepare("SELECT id, tenant_id, sku, name, unit_code, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor, selling_price_minor, wholesale_price_minor, distributor_price_minor, is_active FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1").bind(line.inventoryItemId, tenantId).first<ProductRow>();
        if (!product || (!isOfflineSync && !product.is_active)) throw new ApiError("الصنف غير موجود أو غير نشط", 409);
        if (prescriptionId) {
          const linkedPrescription = prescriptionRecords.find((record) => record.prescription.id === prescriptionId)?.prescription;
          if (!linkedPrescription || linkedPrescription.dispenseQuantityScale !== product.quantity_scale) throw new ApiError("تغيرت دقة وحدة الصنف منذ كتابة الوصفة؛ أعد ربط الصنف بالوصفة", 409);
        }
        const selectedUnit = line.unitId ? await access.context.env.DB.prepare("SELECT id, code, conversion_factor AS conversionFactor, selling_price_minor AS sellingPriceMinor, wholesale_price_minor AS wholesalePriceMinor, distributor_price_minor AS distributorPriceMinor, is_active AS isActive FROM inventory_item_units WHERE id = ? AND tenant_id = ? AND item_id = ? LIMIT 1").bind(line.unitId, tenantId, product.id).first<{ id: string; code: string; conversionFactor: number; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number; isActive: number }>() : null;
        if (line.unitId && (!selectedUnit || !selectedUnit.isActive)) throw new ApiError("وحدة الصنف غير موجودة أو غير نشطة", 409);
        const unitConversionFactor = selectedUnit?.conversionFactor ?? 1;
        const unitQuantity = quantityToUnits(line.quantity, product.quantity_scale);
        const quantity = Math.round(line.quantity * unitConversionFactor);
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new ApiError("كمية الوحدة تتجاوز الحد المسموح");
        if (quoteLine && (quoteLine.inventoryItemId !== product.id || quoteLine.warehouseId !== line.warehouseId || quoteLine.unitId !== (line.unitId ?? null) || quoteLine.quantityScale !== product.quantity_scale || quoteLine.quantity !== quantity || quoteLine.priceTier !== line.priceTier)) throw new ApiError("كمية أو وحدة الصنف تغيرت منذ عرض السعر", 409);
        const selectedRetail = selectedUnit?.sellingPriceMinor ?? product.selling_price_minor;
        const selectedWholesale = selectedUnit?.wholesalePriceMinor ?? product.wholesale_price_minor;
        const selectedDistributor = selectedUnit?.distributorPriceMinor ?? product.distributor_price_minor;
        const unitPriceMinor = quoteLine?.unitPriceMinor ?? (isOfflineSync ? line.offlinePrice!.unitPriceMinor : line.priceTier === "wholesale" ? selectedWholesale : line.priceTier === "distributor" ? selectedDistributor : selectedRetail);
        if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) throw new ApiError("لم يُحدد سعر بيع صالح للصنف حسب فئة السعر المختارة", 409);
        if (isOfflineSync && !await verifyOfflinePrice(access.context.env.SESSION_SECRET!, line.offlinePrice!.token, { tenantId, itemType: "inventory", itemId: product.id, unitId: line.unitId ?? null, branchId: input.branchId, unitPriceMinor })) throw new ApiError("توقيع سعر الصنف غير صالح لهذا المستأجر أو الفرع", 409);
        const warehouse = await access.context.env.DB.prepare("SELECT id, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1").bind(line.warehouseId, tenantId).first<{ id: string; branchId: string | null; isActive: number }>();
        if (!warehouse?.isActive || (warehouse.branchId && warehouse.branchId !== input.branchId)) throw new ApiError("مخزن الصنف غير متاح أو لا يتبع الفرع المحدد", 409);
        const [van] = await db.select({ id: salesReps.id }).from(salesReps).where(and(eq(salesReps.tenantId, tenantId), eq(salesReps.vanWarehouseId, warehouse.id))).limit(1);
        if (van && (!distributionTrip || distributionTrip.vanWarehouseId !== warehouse.id)) throw new ApiError("مخزن السيارة لا يُستخدم للبيع إلا ضمن رحلتها المفتوحة", 409);
        await requireWarehouseBranchMembership(access.context, warehouse.branchId);
        const lineTotalMinor = selectedUnit ? Math.round(line.quantity * unitPriceMinor) : Math.round(quantity * unitPriceMinor / (10 ** product.quantity_scale));
        if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 1 || (quoteLine && quoteLine.lineTotalMinor !== lineTotalMinor)) throw new ApiError("قيمة صنف المخزون لا تطابق عرض السعر");
        subtotalMinor += lineTotalMinor;
        const inventoryItem: InventoryItemRow = { id: product.id, tenant_id: product.tenant_id, sku: product.sku, name: product.name, unit_code: product.unit_code, quantity_scale: product.quantity_scale, tracks_batches: product.tracks_batches, tracks_expiry: product.tracks_expiry, default_cost_minor: product.default_cost_minor };
        pendingProductDeductions.push({ item: inventoryItem, warehouseId: warehouse.id, quantity });
        const itemRow = { id: itemId, tenantId, serviceId: null, providerId: null, inventoryItemId: product.id, stockWarehouseId: warehouse.id, quantityScale: product.quantity_scale, unitId: selectedUnit?.id ?? null, unitQuantity, unitCodeSnapshot: selectedUnit?.code ?? product.unit_code, unitConversionFactor, signedPriceToken: line.offlinePrice?.token ?? null, description: quoteLine?.description ?? `${product.name} (${product.unit_code})`, quantity, unitPriceMinor, lineTotalMinor, priceTier: line.priceTier, commissionBps: 0, createdAt: new Date() };
        itemRows.push(itemRow);
        if (prescriptionId) prescriptionItemRows.set(prescriptionId, itemRow);      }
      if (!Number.isSafeInteger(subtotalMinor)) throw new ApiError("إجمالي الفاتورة يتجاوز الحد المسموح");
    }
    const groupedProducts = new Map<string, PendingProductDeduction>();
    for (const row of pendingProductDeductions) {
      const key = `${row.item.id}:${row.warehouseId}`;
      const current = groupedProducts.get(key);
      if (current) current.quantity += row.quantity;
      else groupedProducts.set(key, { ...row });
    }
    for (const row of groupedProducts.values()) {
      if (!Number.isSafeInteger(row.quantity)) throw new ApiError("مجموع كمية الصنف يتجاوز الحد المسموح");
      if (isOfflineSync) {
        const allocation = await allocateStockForOfflineSale(access.context.env.DB, { tenantId, item: row.item, warehouseId: row.warehouseId, quantity: row.quantity });
        productDeductions.push({ item: row.item, warehouseId: row.warehouseId, allocations: allocation.allocations, requestedQuantity: row.quantity, availableQuantity: allocation.available, shortage: allocation.shortage });
      } else {
        const allocations = await allocateStock(access.context.env.DB, { tenantId, item: row.item, warehouseId: row.warehouseId, quantity: row.quantity });
        productDeductions.push({ item: row.item, warehouseId: row.warehouseId, allocations, requestedQuantity: row.quantity, availableQuantity: row.quantity, shortage: 0 });
      }
    }
    const redeemPoints = input.redeemPoints;
    const loyaltyDiscountMinor = discountMinorForPoints(redeemPoints);
    let redeemAccount: typeof loyaltyAccounts.$inferSelect | null = null;
    if (redeemPoints > 0) {
      [redeemAccount] = await db.select().from(loyaltyAccounts).where(and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, input.customerId))).limit(1);
      if (!redeemAccount || redeemAccount.pointsBalance < redeemPoints) throw new ApiError("رصيد نقاط الولاء غير كافٍ", 409);
    }
    const manualDiscountMinor = Math.round(input.discount * 100);
    let insuranceContract: typeof insuranceContracts.$inferSelect | null = null;
    let insuranceDiscountMinor = 0;
    let insuranceGrossMinor = subtotalMinor - manualDiscountMinor;
    let insurancePatientDueMinor = insuranceGrossMinor;
    let insuranceClaimMinor = 0;
    if (input.insuranceContractId) {
      [insuranceContract] = await db.select().from(insuranceContracts).where(and(eq(insuranceContracts.id, input.insuranceContractId), eq(insuranceContracts.tenantId, tenantId), eq(insuranceContracts.isActive, true))).limit(1);
      if (!insuranceContract) throw new ApiError("جهة التأمين غير موجودة أو غير نشطة", 404);
      insuranceDiscountMinor = Math.round(insuranceGrossMinor * insuranceContract.discountBps / 10000);
      insuranceGrossMinor -= insuranceDiscountMinor;
      insurancePatientDueMinor = Math.round(insuranceGrossMinor * insuranceContract.copayBps / 10000);
      insuranceClaimMinor = insuranceGrossMinor - insurancePatientDueMinor;
    }
    const discountMinor = manualDiscountMinor + insuranceDiscountMinor + loyaltyDiscountMinor;
    const baseTotalMinor = input.insuranceContractId ? Math.max(0, insurancePatientDueMinor - loyaltyDiscountMinor) : subtotalMinor - discountMinor;
    if (baseTotalMinor < 0) throw new ApiError("لا يمكن أن يتجاوز الخصم قيمة الفاتورة");
    let totalMinor = baseTotalMinor;
    let installmentFeeMinor = 0;
    let installmentPlan: ReturnType<typeof buildInstallmentPlan> | null = null;
    if (input.installment) {
      try {
        installmentPlan = buildInstallmentPlan({ baseTotalMinor, downPaymentMinor: Math.round(input.installment.downPayment * 100), interestBps: input.installment.interestBps, adminFeeMinor: Math.round(input.installment.adminFee * 100), installmentCount: input.installment.installmentCount, frequency: input.installment.frequency, firstDueAt: new Date(`${input.installment.firstDueDate}T12:00:00.000Z`) });
      } catch (error) {
        throw new ApiError(error instanceof RangeError ? error.message : "بيانات التقسيط غير صالحة");
      }
      installmentFeeMinor = installmentPlan.totalDueMinor - baseTotalMinor;
      totalMinor = installmentPlan.totalDueMinor;
    }
    const paymentRows = input.payments.map((payment) => ({ id: crypto.randomUUID(), tenantId, invoiceId: "", receivedBy: access.context.user.id, amountMinor: Math.round(payment.amount * 100), paymentMethod: payment.method, reference: payment.reference ?? null, createdAt: new Date() }));
    let paymentSummary;
    try {
      paymentSummary = summarizePayments(paymentRows, totalMinor);
    } catch (error) {
      throw new ApiError(error instanceof RangeError ? error.message : "بيانات الدفعات غير صالحة");
    }
    if (paymentSummary.overpaymentMinor > 0) throw new ApiError("مجموع المدفوعات يتجاوز إجمالي الفاتورة");
    const paidMinor = paymentSummary.totalMinor;
    if (installmentPlan && paidMinor !== installmentPlan.downPaymentMinor) throw new ApiError("يجب أن يساوي مجموع الدفعة المقدمة الدفعة المسجلة في الفاتورة");
    const invoiceId = crypto.randomUUID();
    const dateTag = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const invoiceNumber = `QT-${dateTag}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const createdAt = new Date();
    const invoiceRow = { id: invoiceId, tenantId, branchId: input.branchId, customerId: input.customerId, appointmentId: input.appointmentId ?? null, issuedBy: access.context.user.id, idempotencyKey: requestKey, idempotencyPayloadHash: requestHash, invoiceNumber, subtotalMinor, discountMinor, installmentFeeMinor, totalMinor, paidMinor: 0, currency: "EGP", paymentMethod: "unpaid" as const, status: "issued" as const, syncStatus: "synced" as const, offlineLocalNumber: input.offlineSync?.localInvoiceNumber ?? null, offlineCreatedAt: input.offlineSync ? new Date(input.offlineSync.createdAt) : null, orderType: input.orderType, deliveryCustomerName: input.orderType === "delivery" ? input.deliveryCustomerName?.trim() ?? null : null, deliveryAddress: input.orderType === "delivery" ? input.deliveryAddress?.trim() ?? null : null, deliveryPhone: input.orderType === "delivery" ? input.deliveryPhone?.trim() ?? null : null, courierName: input.orderType === "delivery" ? input.courierName?.trim() ?? null : null, deliveryStatus: input.orderType === "delivery" ? "preparing" as const : null, insuranceContractId: insuranceContract?.id ?? null, insuranceGrossMinor, insurancePatientDueMinor, insuranceClaimMinor, insuranceMemberNumber: input.insuranceMemberNumber ?? null, paidAt: null, createdAt, updatedAt: createdAt };    const normalizedItems = itemRows.map((item) => ({ ...item, invoiceId }));
    const autoClaimId = insuranceContract && insuranceClaimMinor > 0 ? crypto.randomUUID() : null;
    const autoClaimEventId = autoClaimId ? crypto.randomUUID() : null;
    const autoClaimAuditId = autoClaimId ? crypto.randomUUID() : null;
    const installmentContractId = installmentPlan ? crypto.randomUUID() : null;
    const installmentContractRow = installmentPlan ? { id: installmentContractId!, tenantId, invoiceId, customerId: input.customerId, branchId: input.branchId, baseTotalMinor, downPaymentMinor: installmentPlan.downPaymentMinor, interestBps: installmentPlan.interestBps, adminFeeMinor: installmentPlan.adminFeeMinor, totalDueMinor: installmentPlan.totalDueMinor, installmentCount: input.installment!.installmentCount, frequency: input.installment!.frequency, firstDueAt: installmentPlan.dueAt[0]!, status: "active" as const, notes: input.installment!.notes ?? null, createdBy: access.context.user.id, createdAt, updatedAt: createdAt } : null;
    const installmentScheduleRows = installmentPlan?.amountsMinor.map((amountMinor, index) => ({ id: crypto.randomUUID(), tenantId, contractId: installmentContractId!, invoiceId, installmentNumber: index + 1, dueAt: installmentPlan!.dueAt[index]!, amountMinor, paidMinor: 0, status: "unpaid" as const, paidAt: null, paidBy: null, paymentMethod: null, reference: null, createdAt, updatedAt: createdAt })) ?? [];
    const entitlementRows = entitlementSources.map((source) => ({ id: crypto.randomUUID(), tenantId, customerId: input.customerId, serviceId: source.serviceId, invoiceItemId: source.invoiceItemId, totalSessions: source.sessions, usedSessions: 0, validUntil: source.validityDays ? new Date(createdAt.getTime() + source.validityDays * 86_400_000) : null, status: "active" as const, createdAt, updatedAt: createdAt }));
    const posOperationId = productDeductions.length ? crypto.randomUUID() : null;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [db.insert(invoices).values(invoiceRow), db.insert(invoiceItems).values(normalizedItems)];
    if (distributionTrip) statements.push(db.insert(distributionTripInvoices).values({ id: crypto.randomUUID(), tenantId, tripId: distributionTrip.id, invoiceId, createdAt }));
    if (installmentContractRow) statements.push(db.insert(installmentContracts).values(installmentContractRow));
    if (installmentScheduleRows.length) statements.push(db.insert(installmentSchedules).values(installmentScheduleRows));
    if (entitlementRows.length) statements.push(db.insert(customerEntitlements).values(entitlementRows));
    if (insuranceContract && insuranceClaimMinor > 0 && autoClaimId && autoClaimEventId && autoClaimAuditId) {
      statements.push(db.insert(insuranceClaims).values({ id: autoClaimId, tenantId, contractId: insuranceContract.id, invoiceId, customerId: input.customerId, claimMonth: createdAt.toISOString().slice(0, 7), grossMinor: insuranceGrossMinor, patientDueMinor: insurancePatientDueMinor, memberNumber: input.insuranceMemberNumber ?? null, claimMinor: insuranceClaimMinor, status: "open", version: 1, idempotencyKey: null, payloadHash: null, rejectionReason: null, notes: null, createdAt, updatedAt: createdAt }));
      statements.push(db.insert(insuranceClaimEvents).values({ id: autoClaimEventId, tenantId, claimId: autoClaimId, version: 1, type: "created", fromStatus: null, toStatus: "open", actorId: access.context.user.id, idempotencyKey: claimCreationEventKey(requestKey), payloadHash: requestHash, metadataJson: JSON.stringify({ status: "open", source: "invoice_issued", invoiceId }), createdAt }));
      statements.push(db.insert(auditLogs).values({ id: autoClaimAuditId, tenantId, actorId: access.context.user.id, action: "medical.insurance_claim.created", resourceType: "insurance_claim", resourceId: autoClaimId, ipAddress: null, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null, metadataJson: JSON.stringify({ status: "open", source: "invoice_issued", invoiceId, eventId: autoClaimEventId }), createdAt }));
    }
    if (productDeductions.length) {
      statements.push(db.insert(stockOperations).values({ id: posOperationId!, tenantId, operationType: "point_of_sale", idempotencyKey: `pos-invoice:${invoiceId}`, referenceType: "invoice", referenceId: invoiceId, createdBy: access.context.user.id, notes: isPrescriptionDispense ? "خصم أصناف المخزون لصرف روشتة" : "خصم أصناف المخزون من نقطة البيع", metadataJson: JSON.stringify({ invoiceNumber, offline: isOfflineSync, prescriptionDispense: isPrescriptionDispense, productCount: productDeductions.length, shortageCount: productDeductions.filter((product) => product.shortage > 0).length }), createdAt }));
      for (const product of productDeductions) for (const allocation of product.allocations) {
        statements.push(db.insert(inventoryBalances).values({ id: crypto.randomUUID(), tenantId, itemId: product.item.id, warehouseId: product.warehouseId, batchId: allocation.batchId, batchKey: allocation.batchId ?? "", quantityOnHand: 0, updatedAt: createdAt }).onConflictDoNothing());
        statements.push(db.insert(stockMovements).values({ id: crypto.randomUUID(), tenantId, operationId: posOperationId!, itemId: product.item.id, warehouseId: product.warehouseId, batchId: allocation.batchId, movementType: "pos_deduction", quantityDelta: -allocation.quantity, unitCostMinor: allocation.unitCostMinor, referenceType: "invoice", referenceId: invoiceId, note: `خصم نقطة البيع ${invoiceNumber}`, createdBy: access.context.user.id, createdAt }));
      }
      if (isOfflineSync) for (const product of productDeductions.filter((item) => item.shortage > 0)) {
        statements.push(db.insert(offlineStockConflicts).values({ id: crypto.randomUUID(), tenantId, branchId: input.branchId, invoiceId, itemId: product.item.id, warehouseId: product.warehouseId, requestedQuantity: product.requestedQuantity, availableQuantity: product.availableQuantity, shortageQuantity: product.shortage, quantityScale: product.item.quantity_scale, createdBy: access.context.user.id, createdAt, acknowledgedAt: null, acknowledgedBy: null }));
      }
    }
    if (isPrescriptionDispense) {
      const dispenseRows = prescriptionRecords.map(({ prescription }) => {
        const invoiceItem = prescriptionItemRows.get(prescription.id);
        if (!invoiceItem || !prescription.inventoryItemId || !prescription.warehouseId || !prescription.dispenseQuantity || prescription.dispenseQuantityScale === null) throw new ApiError("تعذر إنشاء بند فاتورة مطابق للوصفة", 409);
        return { id: crypto.randomUUID(), tenantId, prescriptionId: prescription.id, invoiceId, inventoryItemId: prescription.inventoryItemId, warehouseId: prescription.warehouseId, quantity: prescription.dispenseQuantity, quantityScale: prescription.dispenseQuantityScale, unitPriceMinor: invoiceItem.unitPriceMinor, lineTotalMinor: invoiceItem.lineTotalMinor, dispensedBy: access.context.user.id, dispensedAt: createdAt };
      });
      statements.push(db.insert(prescriptionDispenses).values(dispenseRows));
    }
    await db.batch(statements);
    for (const [index, payment] of paymentRows.entries()) {
      await applyInvoicePayment({ db: access.context.env.DB, tenantId, invoiceId, userId: access.context.user.id, amountMinor: payment.amountMinor, method: payment.paymentMethod, reference: payment.reference, idempotencyKey: `${requestKey}:payment:${index}`, payloadHash: await payloadFingerprint({ invoiceId, index, amountMinor: payment.amountMinor, method: payment.paymentMethod, reference: payment.reference }), applySchedules: false, now: createdAt });
    }
    if (redeemAccount && redeemPoints > 0) {
      await db.update(loyaltyAccounts).set({ pointsBalance: redeemAccount.pointsBalance - redeemPoints, updatedAt: createdAt }).where(and(eq(loyaltyAccounts.id, redeemAccount.id), eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.pointsBalance, redeemAccount.pointsBalance)));
      await db.insert(loyaltyTransactions).values({ id: crypto.randomUUID(), tenantId, accountId: redeemAccount.id, invoiceId, pointsDelta: -redeemPoints, reason: `redeem:${loyaltyDiscountMinor}`, createdBy: access.context.user.id, createdAt });
    }
    const earnedPoints = pointsEarnedForPurchase(totalMinor);
    if (earnedPoints > 0) {
      await db.insert(loyaltyAccounts).values({ id: crypto.randomUUID(), tenantId, customerId: input.customerId, pointsBalance: 0, lifetimePoints: 0, createdAt, updatedAt: createdAt }).onConflictDoNothing();
      const [account] = await db.select().from(loyaltyAccounts).where(and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, input.customerId))).limit(1);
      if (account) {
        await db.update(loyaltyAccounts).set({ pointsBalance: account.pointsBalance + earnedPoints, lifetimePoints: account.lifetimePoints + earnedPoints, updatedAt: createdAt }).where(and(eq(loyaltyAccounts.id, account.id), eq(loyaltyAccounts.tenantId, tenantId)));
        await db.insert(loyaltyTransactions).values({ id: crypto.randomUUID(), tenantId, accountId: account.id, invoiceId, pointsDelta: earnedPoints, reason: "purchase", createdBy: access.context.user.id, createdAt });
      }
    }
    await writeAudit(access.context, request, "invoice.issued", "invoice", invoiceId, { totalMinor, paidMinor, earnedPoints, inventoryProducts: productDeductions.length, idempotencyKey: requestKey, offlineSync: isOfflineSync, prescriptionCount: prescriptionRecords.length, distributionTripId: distributionTrip?.id ?? null, stockShortageCount: productDeductions.filter((product) => product.shortage > 0).length });
    return Response.json({ invoice: await invoiceResponse(db, tenantId, invoiceId) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (requestKey) {
      const [existing] = await access.context.db.select({ id: invoices.id, payloadHash: invoices.idempotencyPayloadHash }).from(invoices).where(and(eq(invoices.tenantId, access.context.tenantId), eq(invoices.idempotencyKey, requestKey))).limit(1);
      if (existing) {
        if (existing.payloadHash !== requestHash) return Response.json({ error: "مفتاح الفاتورة مستخدم لطلب مختلف؛ أنشئ عملية جديدة" }, { status: 409 });
        return Response.json({ invoice: await invoiceResponse(access.context.db, access.context.tenantId, existing.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if (String(error).includes("prescription_dispenses")) return Response.json({ error: "تم صرف إحدى الوصفات في عملية متزامنة؛ حدّث سجل المريض" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    if (offlineSyncRequested && (String(error).includes("INVENTORY_INSUFFICIENT_STOCK") || String(error).includes("INVENTORY_NEGATIVE_STOCK"))) return Response.json({ error: "تغير رصيد المخزون أثناء المزامنة؛ ستُعاد المحاولة تلقائياً", retryable: true }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
    if (String(error).includes("INVENTORY_INSUFFICIENT_STOCK") || String(error).includes("INVENTORY_NEGATIVE_STOCK")) return Response.json({ error: "رصيد الصنف غير كافٍ؛ لم تصدر الفاتورة ولم يُخصم المخزون" }, { status: 409 });
    return errorResponse(error);
  }
}
