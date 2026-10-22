import { and, count, eq, exists, gte, inArray, lt, sum } from "drizzle-orm";
import { appointments, branches, customers, invoices } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { getAccessibleBranchIds, getAccessibleWarehouseIds, requireBranchMembership } from "@/lib/server/branch-access";
import { isClinicalRole } from "@/lib/operations/permissions";
import { localTimeToUtc } from "@/lib/time/timezone";
import { createXlsxExport, csvEncode, type DataLocale } from "@/lib/operations/data-portability";
import { DATA_CONTRACT_LIMITS, EXPORT_DATASETS, parseExportPagination, type ExportDataset } from "@/lib/operations/data-contracts";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const MAX_EXPORT_ROWS = DATA_CONTRACT_LIMITS.maxExportRows;

type ExportColumn = { key: string; label: string };
type ExportPayload = { dataset: ExportDataset; title: string; generatedAt: string; columns: ExportColumn[]; rows: Array<Record<string, string | number | null>>; truncated: boolean };

const LABELS: Record<ExportDataset, Record<DataLocale, { title: string; columns: ExportColumn[] }>> = {
  inventory: {
    ar: { title: "تصدير الأصناف والمخزون", columns: [{ key: "sku", label: "SKU" }, { key: "barcode", label: "الباركود" }, { key: "name", label: "اسم الصنف" }, { key: "category", label: "الفئة" }, { key: "unitCode", label: "الوحدة" }, { key: "quantityScale", label: "دقة الكمية" }, { key: "quantityOnHand", label: "الرصيد" }, { key: "reorderThreshold", label: "حد إعادة الطلب" }, { key: "defaultCost", label: "تكلفة الوحدة" }, { key: "retailPrice", label: "سعر القطاعي" }, { key: "wholesalePrice", label: "سعر الجملة" }, { key: "distributorPrice", label: "سعر الموزع" }, { key: "variantSize", label: "المقاس" }, { key: "variantColor", label: "اللون" }, { key: "active", label: "نشط" }] },
    en: { title: "Products and inventory export", columns: [{ key: "sku", label: "SKU" }, { key: "barcode", label: "Barcode" }, { key: "name", label: "Product name" }, { key: "category", label: "Category" }, { key: "unitCode", label: "Unit" }, { key: "quantityScale", label: "Quantity scale" }, { key: "quantityOnHand", label: "On hand" }, { key: "reorderThreshold", label: "Reorder threshold" }, { key: "defaultCost", label: "Unit cost" }, { key: "retailPrice", label: "Retail price" }, { key: "wholesalePrice", label: "Wholesale price" }, { key: "distributorPrice", label: "Distributor price" }, { key: "variantSize", label: "Size" }, { key: "variantColor", label: "Color" }, { key: "active", label: "Active" }] },
  },
  invoices: {
    ar: { title: "تصدير الفواتير", columns: [{ key: "invoiceNumber", label: "رقم الفاتورة" }, { key: "createdAt", label: "التاريخ" }, { key: "branch", label: "الفرع" }, { key: "customerName", label: "العميل" }, { key: "customerPhone", label: "الهاتف" }, { key: "status", label: "الحالة" }, { key: "orderType", label: "نوع الطلب" }, { key: "paymentMethod", label: "طريقة الدفع" }, { key: "currency", label: "العملة" }, { key: "subtotalMinor", label: "الإجمالي قبل الخصم (وحدة صغرى)" }, { key: "discountMinor", label: "الخصم (وحدة صغرى)" }, { key: "totalMinor", label: "الإجمالي (وحدة صغرى)" }, { key: "paidMinor", label: "المحصّل (وحدة صغرى)" }, { key: "deliveryStatus", label: "حالة التوصيل" }] },
    en: { title: "Invoices export", columns: [{ key: "invoiceNumber", label: "Invoice number" }, { key: "createdAt", label: "Date" }, { key: "branch", label: "Branch" }, { key: "customerName", label: "Customer" }, { key: "customerPhone", label: "Phone" }, { key: "status", label: "Status" }, { key: "orderType", label: "Order type" }, { key: "paymentMethod", label: "Payment method" }, { key: "currency", label: "Currency" }, { key: "subtotalMinor", label: "Subtotal (minor units)" }, { key: "discountMinor", label: "Discount (minor units)" }, { key: "totalMinor", label: "Total (minor units)" }, { key: "paidMinor", label: "Paid (minor units)" }, { key: "deliveryStatus", label: "Delivery status" }] },
  },
  customers: {
    ar: { title: "تصدير العملاء والمرضى", columns: [{ key: "fullName", label: "الاسم الكامل" }, { key: "phone", label: "الهاتف" }, { key: "email", label: "البريد الإلكتروني" }, { key: "gender", label: "النوع" }, { key: "dateOfBirth", label: "تاريخ الميلاد" }, { key: "branch", label: "الفرع" }, { key: "createdAt", label: "تاريخ الإنشاء" }] },
    en: { title: "Customers and patients export", columns: [{ key: "fullName", label: "Full name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "gender", label: "Gender" }, { key: "dateOfBirth", label: "Date of birth" }, { key: "branch", label: "Branch" }, { key: "createdAt", label: "Created at" }] },
  },
  suppliers: {
    ar: { title: "تصدير الموردين", columns: [{ key: "name", label: "اسم المورد" }, { key: "contactName", label: "مسؤول التواصل" }, { key: "phone", label: "الهاتف" }, { key: "email", label: "البريد الإلكتروني" }, { key: "address", label: "العنوان" }, { key: "taxNumber", label: "الرقم الضريبي" }, { key: "active", label: "نشط" }] },
    en: { title: "Suppliers export", columns: [{ key: "name", label: "Supplier name" }, { key: "contactName", label: "Contact name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" }, { key: "taxNumber", label: "Tax number" }, { key: "active", label: "Active" }] },
  },
  purchases: {
    ar: { title: "تصدير المشتريات", columns: [{ key: "invoiceNumber", label: "رقم فاتورة الشراء" }, { key: "createdAt", label: "التاريخ" }, { key: "supplier", label: "المورد" }, { key: "warehouse", label: "المخزن" }, { key: "status", label: "الحالة" }, { key: "totalMinor", label: "الإجمالي (وحدة صغرى)" }, { key: "paidMinor", label: "المحصّل (وحدة صغرى)" }] },
    en: { title: "Purchases export", columns: [{ key: "invoiceNumber", label: "Purchase invoice number" }, { key: "createdAt", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "warehouse", label: "Warehouse" }, { key: "status", label: "Status" }, { key: "totalMinor", label: "Total (minor units)" }, { key: "paidMinor", label: "Paid (minor units)" }] },
  },
  movements: {
    ar: { title: "تصدير حركات المخزون", columns: [{ key: "createdAt", label: "التاريخ" }, { key: "operationType", label: "نوع العملية" }, { key: "movementType", label: "نوع الحركة" }, { key: "sku", label: "SKU" }, { key: "itemName", label: "الصنف" }, { key: "warehouse", label: "المخزن" }, { key: "quantityDelta", label: "التغير" }, { key: "unitCostMinor", label: "تكلفة الوحدة (وحدة صغرى)" }, { key: "note", label: "الملاحظة" }] },
    en: { title: "Inventory movements export", columns: [{ key: "createdAt", label: "Date" }, { key: "operationType", label: "Operation type" }, { key: "movementType", label: "Movement type" }, { key: "sku", label: "SKU" }, { key: "itemName", label: "Item" }, { key: "warehouse", label: "Warehouse" }, { key: "quantityDelta", label: "Quantity delta" }, { key: "unitCostMinor", label: "Unit cost (minor units)" }, { key: "note", label: "Note" }] },
  },
  payments: {
    ar: { title: "تصدير الدفعات", columns: [{ key: "createdAt", label: "التاريخ" }, { key: "paymentType", label: "نوع الدفعة" }, { key: "invoiceNumber", label: "رقم الفاتورة" }, { key: "party", label: "الطرف" }, { key: "amountMinor", label: "المبلغ (وحدة صغرى)" }, { key: "paymentMethod", label: "طريقة الدفع" }, { key: "reference", label: "المرجع" }] },
    en: { title: "Payments export", columns: [{ key: "createdAt", label: "Date" }, { key: "paymentType", label: "Payment type" }, { key: "invoiceNumber", label: "Invoice number" }, { key: "party", label: "Party" }, { key: "amountMinor", label: "Amount (minor units)" }, { key: "paymentMethod", label: "Payment method" }, { key: "reference", label: "Reference" }] },
  },
  units: {
    ar: { title: "تصدير وحدات المخزون", columns: [{ key: "sku", label: "SKU" }, { key: "itemName", label: "الصنف" }, { key: "code", label: "رمز الوحدة" }, { key: "name", label: "اسم الوحدة" }, { key: "conversionFactor", label: "معامل التحويل" }, { key: "barcode", label: "الباركود" }, { key: "sellingPrice", label: "سعر البيع" }, { key: "active", label: "نشط" }] },
    en: { title: "Inventory units export", columns: [{ key: "sku", label: "SKU" }, { key: "itemName", label: "Item" }, { key: "code", label: "Unit code" }, { key: "name", label: "Unit name" }, { key: "conversionFactor", label: "Conversion factor" }, { key: "barcode", label: "Barcode" }, { key: "sellingPrice", label: "Selling price" }, { key: "active", label: "Active" }] },
  },
  reports: {
    ar: { title: "تصدير التقرير التشغيلي", columns: [{ key: "recordType", label: "نوع السجل" }, { key: "status", label: "الحالة" }, { key: "paymentMethod", label: "طريقة الدفع" }, { key: "currency", label: "العملة" }, { key: "count", label: "العدد" }, { key: "totalMinor", label: "الإجمالي (وحدة صغرى)" }, { key: "paidMinor", label: "المحصّل (وحدة صغرى)" }] },
    en: { title: "Operational report export", columns: [{ key: "recordType", label: "Record type" }, { key: "status", label: "Status" }, { key: "paymentMethod", label: "Payment method" }, { key: "currency", label: "Currency" }, { key: "count", label: "Count" }, { key: "totalMinor", label: "Total (minor units)" }, { key: "paidMinor", label: "Paid (minor units)" }] },
  },
};

function dateNext(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}
function statusText(status: string, locale: DataLocale): string {
  if (locale === "en") return status.replaceAll("_", " ");
  const map: Record<string, string> = { draft: "مسودة", issued: "مستحقة", partially_paid: "مسددة جزئياً", paid: "مسددة", void: "ملغاة", pending: "بانتظار التأكيد", confirmed: "مؤكد", waiting: "في الانتظار", in_progress: "جارٍ", completed: "مكتمل", no_show: "لم يحضر", cancelled: "ملغي", preparing: "قيد التجهيز", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", counter: "مباشر", dine_in: "داخل المنشأة", pickup: "استلام", delivery: "توصيل", female: "أنثى", male: "ذكر", unspecified: "غير محدد" };
  return map[status] ?? status;
}
function normalizeLocale(value: string | null): DataLocale { return value === "en" ? "en" : "ar"; }
function makePayload(dataset: ExportDataset, locale: DataLocale, rows: Array<Record<string, string | number | null>>, truncated = false): ExportPayload {
  const configured = LABELS[dataset];
  const columns = configured?.[locale].columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }));
  return { dataset, title: configured?.[locale].title ?? `${dataset} export`, generatedAt: new Date().toISOString(), columns, rows, truncated };
}

export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }): Promise<Response> {
  try {
    const { dataset: rawDataset } = await params;
    if (!(EXPORT_DATASETS as readonly string[]).includes(rawDataset)) throw new ApiError("Unknown export type.", 404);
    const dataset = rawDataset as ExportDataset;
    const roles = dataset === "inventory" || dataset === "suppliers" || dataset === "purchases" || dataset === "movements" || dataset === "payments" || dataset === "units" ? ["business_admin", "storekeeper"] as const : dataset === "customers" ? ["business_admin", "reception", "provider", "nurse"] as const : dataset === "invoices" ? ["business_admin", "reception"] as const : ["business_admin"] as const;
    const access = await requireOperationAccess(request, roles);
    if (!access.ok) return access.response;
    const url = new URL(request.url);
    const locale = normalizeLocale(url.searchParams.get("locale"));
    const pagination = parseExportPagination(url.searchParams.get("page"), url.searchParams.get("pageSize"));
    if (pagination.offset >= MAX_EXPORT_ROWS) throw new ApiError(`Export pages are limited to the first ${MAX_EXPORT_ROWS} rows.`);
    const pageLimit = Math.min(pagination.pageSize, MAX_EXPORT_ROWS - pagination.offset);
    const format = url.searchParams.get("format") === "json" ? "json" : url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const { context } = access;
    let rows: Array<Record<string, string | number | null>> = [];
    let truncated = false;

    if (dataset === "inventory") {
      const warehouseIds = await getAccessibleWarehouseIds(context);
      if (warehouseIds.length) {
        const result = await context.env.DB.prepare(`SELECT i.sku, i.barcode, i.name, i.category, i.unit_code AS unitCode, i.quantity_scale AS quantityScale, i.reorder_threshold AS reorderThresholdUnits, i.default_cost_minor AS defaultCostMinor, i.selling_price_minor AS retailPriceMinor, i.wholesale_price_minor AS wholesalePriceMinor, i.distributor_price_minor AS distributorPriceMinor, i.variant_size AS variantSize, i.variant_color AS variantColor, i.is_active AS isActive, COALESCE(SUM(b.quantity_on_hand), 0) AS quantityOnHandUnits FROM inventory_items i LEFT JOIN inventory_balances b ON b.tenant_id = i.tenant_id AND b.item_id = i.id AND b.warehouse_id IN (${warehouseIds.map(() => "?").join(",")}) WHERE i.tenant_id = ? GROUP BY i.id ORDER BY i.name, i.sku LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(...warehouseIds, context.tenantId).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, reorderThreshold: (Number(row.reorderThresholdUnits) || 0) / (10 ** (Number(row.quantityScale) || 0)), quantityOnHand: (Number(row.quantityOnHandUnits) || 0) / (10 ** (Number(row.quantityScale) || 0)), defaultCost: (Number(row.defaultCostMinor) || 0) / 100, retailPrice: (Number(row.retailPriceMinor) || 0) / 100, wholesalePrice: (Number(row.wholesalePriceMinor) || 0) / 100, distributorPrice: (Number(row.distributorPriceMinor) || 0) / 100, active: Number(row.isActive) ? (locale === "ar" ? "نعم" : "Yes") : (locale === "ar" ? "لا" : "No") }));
      }
    } else if (dataset === "invoices") {
      const branchIds = await getAccessibleBranchIds(context);
      if (branchIds.length) {
        const result = await context.env.DB.prepare(`SELECT i.invoice_number AS invoiceNumber, i.created_at AS createdAtUnix, b.name AS branch, c.full_name AS customerName, c.phone AS customerPhone, i.status, i.order_type AS orderType, i.payment_method AS paymentMethod, i.currency, i.subtotal_minor AS subtotalMinor, i.discount_minor AS discountMinor, i.total_minor AS totalMinor, i.paid_minor AS paidMinor, i.delivery_status AS deliveryStatus FROM invoices i LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id WHERE i.tenant_id = ? AND i.branch_id IN (${branchIds.map(() => "?").join(",")}) ORDER BY i.created_at DESC LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId, ...branchIds).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, createdAt: new Date(Number(row.createdAtUnix) * 1000).toISOString(), status: statusText(String(row.status ?? ""), locale), orderType: statusText(String(row.orderType ?? ""), locale), paymentMethod: statusText(String(row.paymentMethod ?? ""), locale), deliveryStatus: row.deliveryStatus ? statusText(String(row.deliveryStatus), locale) : null }));
      }
    } else if (dataset === "customers") {
      const branchIds = await getAccessibleBranchIds(context);
      if (branchIds.length) {
        const filters = [eq(customers.tenantId, context.tenantId), inArray(customers.branchId, branchIds)];
        if (isClinicalRole(context.session.role)) {
          const providerAppointment = context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.customerId, customers.id), eq(appointments.providerId, context.session.sub)));
          filters.push(exists(providerAppointment));
        }
        const result = await context.db.select({ fullName: customers.fullName, phone: customers.phone, email: customers.email, gender: customers.gender, dateOfBirth: customers.dateOfBirth, branch: branches.name, createdAt: customers.createdAt }).from(customers).leftJoin(branches, and(eq(branches.id, customers.branchId), eq(branches.tenantId, customers.tenantId))).where(and(...filters)).orderBy(customers.fullName).limit(pageLimit + 1).offset(pagination.offset);
        truncated = result.length > pageLimit;
        rows = result.slice(0, pageLimit).map((row) => ({ ...row, gender: statusText(row.gender, locale), dateOfBirth: row.dateOfBirth, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) }));
      }
    } else if (dataset === "suppliers") {
      const result = await context.env.DB.prepare(`SELECT name, contact_name AS contactName, phone, email, address, tax_number AS taxNumber, is_active AS isActive FROM suppliers WHERE tenant_id = ? ORDER BY name LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId).all<Record<string, string | number | null>>();
      truncated = result.results.length > pageLimit;
      rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, active: Number(row.isActive) ? (locale === "ar" ? "نعم" : "Yes") : (locale === "ar" ? "لا" : "No") }));
    } else if (dataset === "purchases") {
      const warehouseIds = await getAccessibleWarehouseIds(context);
      if (warehouseIds.length) {
        const result = await context.env.DB.prepare(`SELECT p.invoice_number AS invoiceNumber, p.created_at AS createdAtUnix, s.name AS supplier, w.name AS warehouse, p.status, p.total_minor AS totalMinor, p.paid_minor AS paidMinor FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id JOIN inventory_warehouses w ON w.id = p.warehouse_id AND w.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.warehouse_id IN (${warehouseIds.map(() => "?").join(",")}) ORDER BY p.created_at DESC, p.id DESC LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId, ...warehouseIds).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, createdAt: new Date(Number(row.createdAtUnix) * 1000).toISOString(), status: statusText(String(row.status ?? ""), locale) }));
      }
    } else if (dataset === "movements") {
      const warehouseIds = await getAccessibleWarehouseIds(context);
      if (warehouseIds.length) {
        const result = await context.env.DB.prepare(`SELECT m.created_at AS createdAtUnix, o.operation_type AS operationType, m.movement_type AS movementType, i.sku, i.name AS itemName, w.name AS warehouse, m.quantity_delta AS quantityDelta, m.unit_cost_minor AS unitCostMinor, m.note FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id JOIN inventory_warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id JOIN stock_operations o ON o.id = m.operation_id AND o.tenant_id = m.tenant_id WHERE m.tenant_id = ? AND m.warehouse_id IN (${warehouseIds.map(() => "?").join(",")}) ORDER BY m.created_at DESC, m.id DESC LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId, ...warehouseIds).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, createdAt: new Date(Number(row.createdAtUnix) * 1000).toISOString() }));
      }
    } else if (dataset === "units") {
      const warehouseIds = await getAccessibleWarehouseIds(context);
      if (warehouseIds.length) {
        const result = await context.env.DB.prepare(`SELECT i.sku, i.name AS itemName, u.code, u.name, u.conversion_factor AS conversionFactor, u.barcode, u.selling_price_minor AS sellingPriceMinor, u.is_active AS isActive FROM inventory_item_units u JOIN inventory_items i ON i.id = u.item_id AND i.tenant_id = u.tenant_id WHERE u.tenant_id = ? AND u.is_active = 1 AND EXISTS (SELECT 1 FROM inventory_balances b WHERE b.tenant_id = u.tenant_id AND b.item_id = u.item_id AND b.warehouse_id IN (${warehouseIds.map(() => "?").join(",")})) ORDER BY i.name, u.code LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId, ...warehouseIds).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, sellingPrice: (Number(row.sellingPriceMinor) || 0) / 100, active: Number(row.isActive) ? (locale === "ar" ? "نعم" : "Yes") : (locale === "ar" ? "لا" : "No") }));
      }
    } else if (dataset === "payments") {
      const branchIds = await getAccessibleBranchIds(context);
      if (branchIds.length) {
        const result = await context.env.DB.prepare(`SELECT created_at AS createdAtUnix, 'invoice' AS paymentType, i.invoice_number AS invoiceNumber, c.full_name AS party, p.amount_minor AS amountMinor, p.payment_method AS paymentMethod, p.reference FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id WHERE p.tenant_id = ? AND i.branch_id IN (${branchIds.map(() => "?").join(",")}) AND p.reversed_at IS NULL UNION ALL SELECT p.created_at AS createdAtUnix, 'supplier' AS paymentType, i.invoice_number AS invoiceNumber, s.name AS party, p.amount_minor AS amountMinor, p.payment_method AS paymentMethod, p.reference FROM supplier_payments p JOIN purchase_invoices i ON i.id = p.purchase_invoice_id AND i.tenant_id = p.tenant_id JOIN suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id WHERE p.tenant_id = ? ORDER BY createdAtUnix DESC LIMIT ${pageLimit + 1} OFFSET ${pagination.offset}`).bind(context.tenantId, ...branchIds, context.tenantId).all<Record<string, string | number | null>>();
        truncated = result.results.length > pageLimit;
        rows = result.results.slice(0, pageLimit).map((row) => ({ ...row, paymentType: row.paymentType === "supplier" ? (locale === "ar" ? "مورد" : "Supplier") : (locale === "ar" ? "عميل" : "Customer"), paymentMethod: statusText(String(row.paymentMethod ?? ""), locale), createdAt: new Date(Number(row.createdAtUnix) * 1000).toISOString() }));
      }
    } else {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const branchId = url.searchParams.get("branchId")?.trim() || null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new ApiError("Select a valid date period.");
      const start = localTimeToUtc(from, "00:00", context.tenant.timezone);
      const end = localTimeToUtc(dateNext(to), "00:00", context.tenant.timezone);
      if (!start || !end || end.getTime() - start.getTime() > 367 * 86_400_000) throw new ApiError("The report period is invalid or exceeds one year.");
      const accessible = await getAccessibleBranchIds(context);
      if (!accessible.length) return respond(makePayload(dataset, locale, []), format, pagination, pageLimit);
      const appointmentFilters = [eq(appointments.tenantId, context.tenantId), gte(appointments.startsAt, start), lt(appointments.startsAt, end)];
      const invoiceFilters = [eq(invoices.tenantId, context.tenantId), gte(invoices.createdAt, start), lt(invoices.createdAt, end)];
      if (branchId) {
        if (!/^[0-9a-f-]{36}$/i.test(branchId)) throw new ApiError("The branch ID is invalid.");
        await requireBranchMembership(context, branchId);
        appointmentFilters.push(eq(appointments.branchId, branchId)); invoiceFilters.push(eq(invoices.branchId, branchId));
      } else { appointmentFilters.push(inArray(appointments.branchId, accessible)); invoiceFilters.push(inArray(invoices.branchId, accessible)); }
      const [appointmentRows, invoiceRows] = await Promise.all([
        context.db.select({ status: appointments.status, value: count() }).from(appointments).where(and(...appointmentFilters)).groupBy(appointments.status),
        context.db.select({ currency: invoices.currency, status: invoices.status, paymentMethod: invoices.paymentMethod, count: count(), totalMinor: sum(invoices.totalMinor), paidMinor: sum(invoices.paidMinor) }).from(invoices).where(and(...invoiceFilters)).groupBy(invoices.currency, invoices.status, invoices.paymentMethod),
      ]);
      rows = [
        ...appointmentRows.map((row) => ({ recordType: locale === "ar" ? "موعد" : "Appointment", status: statusText(row.status, locale), paymentMethod: "", currency: "", count: Number(row.value) || 0, totalMinor: 0, paidMinor: 0 })),
        ...invoiceRows.map((row) => ({ recordType: locale === "ar" ? "فاتورة" : "Invoice", status: statusText(row.status, locale), paymentMethod: statusText(row.paymentMethod, locale), currency: row.currency, count: Number(row.count) || 0, totalMinor: Number(row.totalMinor) || 0, paidMinor: Number(row.paidMinor) || 0 })),
      ];
    }

    return respond(makePayload(dataset, locale, rows, truncated), format, pagination, pageLimit);
  } catch (error) { return errorResponse(error, "Unable to export the requested data."); }
}

function respond(payload: ExportPayload, format: "csv" | "xlsx" | "json", pagination: { page: number; pageSize: number; offset: number }, pageLimit: number): Response {
  if (format === "json") return Response.json({ ...payload, pagination: { ...pagination, returned: payload.rows.length, hasNext: payload.rows.length > pageLimit || payload.truncated } }, { headers: { "Cache-Control": "no-store" } });
  const table = [payload.columns.map((column) => column.label), ...payload.rows.map((row) => payload.columns.map((column) => row[column.key] ?? ""))];
  const data = format === "xlsx" ? createXlsxExport(table[0]!.map(String), table.slice(1), payload.dataset) : csvEncode(table);
  const body: BodyInit = typeof data === "string" ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const extension = format === "xlsx" ? "xlsx" : "csv";
  const contentType = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  const filename = `qutoof-${payload.dataset}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  return new Response(body, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store", "X-Export-Truncated": payload.truncated ? "true" : "false", "X-Export-Page": String(pagination.page), "X-Export-Page-Size": String(pagination.pageSize) } });
}
