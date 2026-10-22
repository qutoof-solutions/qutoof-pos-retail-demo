import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { branches, customers, invoices, quotationItems, quotations, services } from "@/lib/db/schema";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";
import { quantityToUnits } from "@/lib/operations/inventory";
import { payloadFingerprint } from "@/lib/operations/idempotency";

export const runtime = "edge";
const serviceLine = z.object({ type: z.literal("service"), serviceId: uuidSchema, quantity: z.number().int().min(1).max(100) });
const inventoryLine = z.object({ type: z.literal("inventory"), inventoryItemId: uuidSchema, warehouseId: uuidSchema, unitId: uuidSchema.optional(), quantity: z.number().finite().gt(0).max(1_000_000), priceTier: z.enum(["retail", "wholesale", "distributor"]).default("retail") });
const quoteInput = z.object({ idempotencyKey: z.string().trim().min(8).max(120), branchId: uuidSchema, customerId: uuidSchema, discount: moneySchema.max(10_000_000).default(0), items: z.array(z.union([serviceLine, inventoryLine])).min(1).max(40), validDays: z.number().int().min(1).max(365).default(30), notes: z.string().trim().max(1000).nullable().optional() });

async function readQuote(db: ReturnType<typeof import("@/lib/db/client").getDb>, tenantId: string, id: string) {
  const [quote] = await db.select().from(quotations).where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId))).limit(1);
  if (!quote) return null;
  const items = await db.select().from(quotationItems).where(and(eq(quotationItems.tenantId, tenantId), eq(quotationItems.quotationId, id))).orderBy(quotationItems.createdAt);
  const [customer] = await db.select({ fullName: customers.fullName, phone: customers.phone }).from(customers).where(and(eq(customers.id, quote.customerId), eq(customers.tenantId, tenantId))).limit(1);
  const [branch] = await db.select({ name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.id, quote.branchId), eq(branches.tenantId, tenantId))).limit(1);
  let convertedInvoice = null;
  if (quote.convertedInvoiceId) {
    const [invoice] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status }).from(invoices).where(and(eq(invoices.id, quote.convertedInvoiceId), eq(invoices.tenantId, tenantId))).limit(1);
    convertedInvoice = invoice ?? null;
  }
  return { ...quote, customerName: customer?.fullName ?? null, customerPhone: customer?.phone ?? null, branchName: branch?.name ?? null, branchNameAr: branch?.nameAr ?? null, branchNameEn: branch?.nameEn ?? null, convertedInvoice, items };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  const accessible = await getAccessibleBranchIds(access.context);
  if (!accessible.length) return Response.json({ quotations: [] }, { headers: { "Cache-Control": "no-store" } });
  const filters = [eq(quotations.tenantId, access.context.tenantId), inArray(quotations.branchId, accessible)];
  if (branchId) {
    if (!uuidSchema.safeParse(branchId).success) return Response.json({ error: "معرف الفرع غير صالح" }, { status: 400 });
    await requireBranchMembership(access.context, branchId);
    filters.splice(1, 1, eq(quotations.branchId, branchId));
  }
  const rows = await access.context.db.select().from(quotations).where(and(...filters)).orderBy(desc(quotations.createdAt)).limit(100);
  const ids = rows.map((row) => row.id);
  const [allItems, allCustomers, allBranches] = ids.length ? await Promise.all([
    access.context.db.select().from(quotationItems).where(and(eq(quotationItems.tenantId, access.context.tenantId), inArray(quotationItems.quotationId, ids))).orderBy(quotationItems.createdAt),
    access.context.db.select({ id: customers.id, fullName: customers.fullName, phone: customers.phone }).from(customers).where(and(eq(customers.tenantId, access.context.tenantId), inArray(customers.id, [...new Set(rows.map((row) => row.customerId))]))),
    access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, access.context.tenantId), inArray(branches.id, [...new Set(rows.map((row) => row.branchId))]))),
  ]) : [[], [], []];
  return Response.json({ quotations: rows.map((row) => ({ ...row, customerName: allCustomers.find((customer) => customer.id === row.customerId)?.fullName ?? null, customerPhone: allCustomers.find((customer) => customer.id === row.customerId)?.phone ?? null, branchName: allBranches.find((branch) => branch.id === row.branchId)?.name ?? null, branchNameAr: allBranches.find((branch) => branch.id === row.branchId)?.nameAr ?? null, branchNameEn: allBranches.find((branch) => branch.id === row.branchId)?.nameEn ?? null, items: allItems.filter((item) => item.quotationId === row.id) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  let idempotencyKey = "";
  let payloadHash = "";
  try {
    const parsed = quoteInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || "تحقق من بيانات عرض السعر");
    const input = parsed.data;
    idempotencyKey = input.idempotencyKey;
    payloadHash = await payloadFingerprint({ branchId: input.branchId, customerId: input.customerId, discount: input.discount, validDays: input.validDays, notes: input.notes ?? null, items: input.items });
    const { db, tenantId } = access.context;
    const [existing] = await db.select({ id: quotations.id, payloadHash: quotations.payloadHash, branchId: quotations.branchId }).from(quotations).where(and(eq(quotations.tenantId, tenantId), eq(quotations.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ApiError("مفتاح عرض السعر مستخدم لطلب مختلف", 409);
      await requireBranchMembership(access.context, existing.branchId);
      return Response.json({ quotation: await readQuote(db, tenantId, existing.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await requireBranchMembership(access.context, input.branchId);
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود أو غير نشط", 404);
    const [customer] = await db.select({ id: customers.id, branchId: customers.branchId }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    if (customer.branchId !== input.branchId) {
      const [visit] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, input.customerId), eq(invoices.branchId, input.branchId))).limit(1);
      if (!visit) throw new ApiError("ملف العميل لا يملك علاقة مسجلة بهذا الفرع", 404);
    }
    const quoteId = crypto.randomUUID();
    const now = new Date();
    const validUntil = new Date(now.getTime() + input.validDays * 86_400_000);
    const dateTag = now.toISOString().slice(0, 10).replaceAll("-", "");
    const quoteNumber = `QO-${dateTag}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const itemRows: Array<typeof quotationItems.$inferInsert> = [];
    let subtotalMinor = 0;
    for (const line of input.items) {
      if (line.type === "service") {
        const [service] = await db.select({ id: services.id, name: services.name, priceMinor: services.priceMinor, branchId: services.branchId, isActive: services.isActive, providerCommissionBps: services.providerCommissionBps }).from(services).where(and(eq(services.id, line.serviceId), eq(services.tenantId, tenantId))).limit(1);
        if (!service || !service.isActive || (service.branchId && service.branchId !== input.branchId)) throw new ApiError("إحدى الخدمات غير متاحة في الفرع المحدد", 409);
        const lineTotalMinor = service.priceMinor * line.quantity;
        if (!Number.isSafeInteger(lineTotalMinor)) throw new ApiError("قيمة بند عرض السعر تتجاوز الحد المسموح");
        subtotalMinor += lineTotalMinor;
        itemRows.push({ id: crypto.randomUUID(), tenantId, quotationId: quoteId, serviceId: service.id, inventoryItemId: null, warehouseId: null, description: service.name, quantity: line.quantity, quantityScale: 0, unitPriceMinor: service.priceMinor, lineTotalMinor, priceTier: "retail", commissionBps: service.providerCommissionBps, createdAt: now });
      } else {
        const product = await access.context.env.DB.prepare("SELECT id, name, unit_code AS unitCode, quantity_scale AS quantityScale, selling_price_minor AS retail, wholesale_price_minor AS wholesale, distributor_price_minor AS distributor, is_active AS isActive FROM inventory_items WHERE id = ? AND tenant_id = ? LIMIT 1").bind(line.inventoryItemId, tenantId).first<{ id: string; name: string; unitCode: string; quantityScale: number; retail: number; wholesale: number; distributor: number; isActive: number }>();
        if (!product?.isActive) throw new ApiError("الصنف غير موجود أو غير نشط", 409);
        const warehouse = await access.context.env.DB.prepare("SELECT id, branch_id AS branchId, is_active AS isActive FROM inventory_warehouses WHERE id = ? AND tenant_id = ? LIMIT 1").bind(line.warehouseId, tenantId).first<{ id: string; branchId: string | null; isActive: number }>();
        if (!warehouse?.isActive || (warehouse.branchId && warehouse.branchId !== input.branchId)) throw new ApiError("مخزن الصنف غير متاح أو لا يتبع الفرع المحدد", 409);
        await requireWarehouseBranchMembership(access.context, warehouse.branchId);
        const selectedUnit = line.unitId ? await access.context.env.DB.prepare("SELECT id, code, conversion_factor AS conversionFactor, selling_price_minor AS sellingPriceMinor, wholesale_price_minor AS wholesalePriceMinor, distributor_price_minor AS distributorPriceMinor, is_active AS isActive FROM inventory_item_units WHERE id = ? AND tenant_id = ? AND item_id = ? LIMIT 1").bind(line.unitId, tenantId, product.id).first<{ id: string; code: string; conversionFactor: number; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number; isActive: number }>() : null;
        if (line.unitId && (!selectedUnit || !selectedUnit.isActive)) throw new ApiError("وحدة الصنف غير موجودة أو غير نشطة", 409);
        const unitConversionFactor = selectedUnit?.conversionFactor ?? 1;
        const unitPriceMinor = selectedUnit ? (line.priceTier === "wholesale" ? selectedUnit.wholesalePriceMinor : line.priceTier === "distributor" ? selectedUnit.distributorPriceMinor : selectedUnit.sellingPriceMinor) : (line.priceTier === "wholesale" ? product.wholesale : line.priceTier === "distributor" ? product.distributor : product.retail);
        if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) throw new ApiError("لم يُحدد سعر صالح لفئة السعر المختارة", 409);
        const quantity = selectedUnit ? Math.round(line.quantity * unitConversionFactor) : quantityToUnits(line.quantity, product.quantityScale);
        const lineTotalMinor = selectedUnit ? Math.round(line.quantity * unitPriceMinor) : Math.round(quantity * unitPriceMinor / (10 ** product.quantityScale));
        if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 1) throw new ApiError("قيمة بند عرض السعر غير صالحة");
        subtotalMinor += lineTotalMinor;
        itemRows.push({ id: crypto.randomUUID(), tenantId, quotationId: quoteId, serviceId: null, inventoryItemId: product.id, warehouseId: warehouse.id, unitId: selectedUnit?.id ?? null, unitCodeSnapshot: selectedUnit?.code ?? product.unitCode, unitConversionFactor, priceSnapshotMinor: unitPriceMinor, description: `${product.name} (${selectedUnit?.code ?? product.unitCode})`, quantity, quantityScale: product.quantityScale, unitPriceMinor, lineTotalMinor, priceTier: line.priceTier, commissionBps: 0, createdAt: now });
      }
      if (!Number.isSafeInteger(subtotalMinor)) throw new ApiError("إجمالي عرض السعر يتجاوز الحد المسموح");
    }
    const discountMinor = Math.round(input.discount * 100);
    const totalMinor = subtotalMinor - discountMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new ApiError("لا يمكن أن يتجاوز الخصم قيمة العرض");
    const quoteRow = { id: quoteId, tenantId, branchId: input.branchId, customerId: input.customerId, createdBy: access.context.user.id, convertedInvoiceId: null, idempotencyKey, payloadHash, quoteNumber, status: "issued" as const, subtotalMinor, discountMinor, totalMinor, currency: "EGP", validUntil, notes: input.notes?.trim() || null, createdAt: now, updatedAt: now };
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [db.insert(quotations).values(quoteRow), db.insert(quotationItems).values(itemRows)];
    await db.batch(statements);
    await writeAudit(access.context, request, "quotation.issued", "quotation", quoteId, { quoteNumber, totalMinor, itemCount: itemRows.length });
    return Response.json({ quotation: { ...quoteRow, items: itemRows }, replayed: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (idempotencyKey) {
      const [existing] = await access.context.db.select({ id: quotations.id, payloadHash: quotations.payloadHash, branchId: quotations.branchId }).from(quotations).where(and(eq(quotations.tenantId, access.context.tenantId), eq(quotations.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) return Response.json({ error: "مفتاح عرض السعر مستخدم لطلب مختلف" }, { status: 409 });
        try { await requireBranchMembership(access.context, existing.branchId); }
        catch (scopeError) { return errorResponse(scopeError); }
        return Response.json({ quotation: await readQuote(access.context.db, access.context.tenantId, existing.id), replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    return errorResponse(error);
  }
}
