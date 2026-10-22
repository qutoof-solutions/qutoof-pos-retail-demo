import { z } from "zod";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds, getAccessibleWarehouseIds, requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";
import { roleMatchesAny } from "@/lib/operations/permissions";
import { phoneSchema } from "@/lib/operations/validation";
import { createBalanceStatement, createBalanceStatementByLot } from "@/lib/operations/inventory";
import { parseCsv, parseXlsx, rowsToRecords, type ImportDataset, type ParsedRow } from "@/lib/operations/data-portability";
import { readRequestBodyLimited } from "@/lib/records/attachments";
import { DATA_CONTRACT_LIMITS, assertImportRowCount } from "@/lib/operations/data-contracts";

export const runtime = "edge";

const MAX_FILE_BYTES = DATA_CONTRACT_LIMITS.maxImportFileBytes;
const MAX_MULTIPART_BYTES = DATA_CONTRACT_LIMITS.maxImportMultipartBytes;
const MAX_ROWS = DATA_CONTRACT_LIMITS.maxImportRows;
const MAX_ERRORS = DATA_CONTRACT_LIMITS.maxImportErrors;
const KEY_SCHEMA = z.string().trim().min(16).max(90).regex(/^[A-Za-z0-9:_-]+$/);

type ImportError = { dataset: ImportDataset; row: number; message: string };
type WarehouseRow = { id: string; code: string; name: string; branch_id: string | null };
type InventoryRow = { id: string; sku: string; quantity_scale: number; tracks_batches: number; tracks_expiry: number; default_cost_minor: number };
type PlannedProduct = { id: string; row: number; sku: string; barcode: string | null; name: string; description: string | null; category: string; unitCode: string; quantityScale: number; reorderThreshold: number; defaultCostMinor: number; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number; variantSize: string | null; variantColor: string | null; tracksBatches: boolean; tracksExpiry: boolean; opening?: { warehouseId: string; quantityUnits: number; unitCostMinor: number; lotNumber: string | null; expiresOn: string | null; row: number } };
type PlannedStock = { id: string; itemId: string; sku: string; warehouseId: string; quantityUnits: number; unitCostMinor: number; lotNumber: string | null; expiresOn: string | null; row: number };
type PlannedCustomer = { id: string; dataset: "customers" | "patients"; row: number; fullName: string; phone: string; email: string | null; gender: "female" | "male" | "unspecified"; dateOfBirth: string | null; notes: string | null };
type PlannedSupplier = { id: string; row: number; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; taxNumber: string | null; notes: string | null };
type Summary = { inserted: Record<ImportDataset, number>; skipped: Record<ImportDataset, number>; rows: Record<ImportDataset, number>; errors: ImportError[]; warnings: ImportError[] };

function emptyCounts(): Record<ImportDataset, number> { return { products: 0, stock: 0, customers: 0, patients: 0, suppliers: 0 }; }
function normalizePhone(value: string): string { return value.replace(/\D/g, ""); }
function normalizeCode(value: string): string { return value.trim().toLocaleLowerCase(); }
function textValue(value: string | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value exceeds ${max} characters.`);
  return text;
}
function numberValue(value: string | undefined, label: string, max: number, optional = false): number | null {
  const raw = (value ?? "").trim();
  if (!raw && optional) return null;
  if (!raw) return 0;
  const parsed = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} must be a number from 0 to ${max}.`);
  return parsed;
}
function moneyMinor(value: string | undefined, label: string, optional = false): number {
  const amount = numberValue(value, label, 100_000_000, optional);
  const minor = Math.round((amount ?? 0) * 100);
  if (!Number.isSafeInteger(minor)) throw new Error(`${label} is outside the supported money range.`);
  return minor;
}
function quantityUnits(value: string | undefined, scale: number, label: string, allowZero: boolean): number {
  const quantity = numberValue(value, label, 1_000_000, true) ?? 0;
  if ((!allowZero && quantity <= 0) || (allowZero && quantity < 0)) throw new Error(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`);
  const factor = 10 ** scale;
  const units = Math.round(quantity * factor);
  if (!Number.isSafeInteger(units) || Math.abs(units / factor - quantity) > 1e-8) throw new Error(`${label} has more decimal places than the item's quantity scale (${scale}).`);
  return units;
}
function booleanValue(value: string | undefined, label: string): boolean {
  const normalized = (value ?? "").trim().toLocaleLowerCase();
  if (!normalized || ["0", "false", "no", "n", "off", "لا", "كلا"].includes(normalized)) return false;
  if (["1", "true", "yes", "y", "on", "نعم", "ن", "صحيح"].includes(normalized)) return true;
  throw new Error(`${label} must be yes/no, true/false, 1/0, نعم/لا.`);
}
function dateValue(value: string | undefined, label: string, allowFuture = true): string | null {
  const date = (value ?? "").trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error(`${label} must use YYYY-MM-DD.`);
  if (!allowFuture && date > new Date().toISOString().slice(0, 10)) throw new Error(`${label} cannot be in the future.`);
  return date;
}
function parseGender(value: string | undefined): "female" | "male" | "unspecified" {
  const normalized = (value ?? "").trim().toLocaleLowerCase();
  if (!normalized || ["unspecified", "unknown", "other", "غير محدد", "غير معروف"].includes(normalized)) return "unspecified";
  if (["female", "f", "woman", "أنثى", "انثى", "سيدة"].includes(normalized)) return "female";
  if (["male", "m", "man", "ذكر", "رجل"].includes(normalized)) return "male";
  throw new Error("Gender must be female, male, or unspecified.");
}
function addError(errors: ImportError[], dataset: ImportDataset, row: number, error: unknown): void {
  if (errors.length < MAX_ERRORS) errors.push({ dataset, row, message: error instanceof Error ? error.message : "Invalid row." });
}
function sheetRowsFromFile(fileName: string, fileBytes: Uint8Array, csvText: string, csvDataset: ImportDataset | null): Partial<Record<ImportDataset, string[][]>> {
  if (/\.csv$/i.test(fileName)) {
    if (!csvDataset) throw new ApiError("Select a data type for CSV import.");
    return { [csvDataset]: parseCsv(csvText) };
  }
  if (!/\.xlsx$/i.test(fileName)) throw new ApiError("Only .xlsx and .csv files are supported.");
  return parseXlsx(fileBytes);
}
async function fileBytes(file: File): Promise<Uint8Array> {
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new ApiError("The file must be between 1 byte and 5 MB.", 413);
  return new Uint8Array(await file.arrayBuffer());
}
function nowUnix(): number { return Math.floor(Date.now() / 1000); }
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper", "reception"]);
  if (!access.ok) return access.response;
  const { context } = access;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLocaleLowerCase().startsWith("multipart/form-data;")) throw new ApiError("Upload the workbook as multipart/form-data.", 415);
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const requestBytes = Number(contentLength);
      if (!Number.isSafeInteger(requestBytes) || requestBytes < 1 || requestBytes > MAX_MULTIPART_BYTES) throw new ApiError("The upload request exceeds the allowed size.", 413);
    }
    const boundedBody = await readRequestBodyLimited(request, MAX_MULTIPART_BYTES);
    if (!boundedBody) throw new ApiError("The upload request is empty or exceeds the allowed size.", 413);
    const formBody = new ArrayBuffer(boundedBody.byteLength);
    new Uint8Array(formBody).set(boundedBody);
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: formBody }).formData(); }
    catch { throw new ApiError("The multipart upload format is invalid."); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("Choose an .xlsx or .csv file.");
    const mode = form.get("mode") === "preview" ? "preview" : form.get("mode") === "commit" ? "commit" : "";
    if (!mode) throw new ApiError("Select preview or import mode.");
    const csvDatasetRaw = String(form.get("dataset") ?? "");
    const allowedDatasets: ImportDataset[] = ["products", "stock", "customers", "patients", "suppliers"];
    const csvDataset = allowedDatasets.includes(csvDatasetRaw as ImportDataset) ? csvDatasetRaw as ImportDataset : null;
    const keyInput = request.headers.get("Idempotency-Key") ?? String(form.get("idempotencyKey") ?? "");
    const idempotencyKey = KEY_SCHEMA.safeParse(keyInput);
    if (mode === "commit" && !idempotencyKey.success) throw new ApiError("A valid idempotency key is required to import this file.");
    const branchIds = await getAccessibleBranchIds(context);
    if (!branchIds.length) throw new ApiError("You are not assigned to an active branch.", 403);
    const allRows = sheetRowsFromFile(file.name, await fileBytes(file), await file.text(), csvDataset);
    const populated = Object.entries(allRows).filter((entry): entry is [ImportDataset, string[][]] => Array.isArray(entry[1]) && entry[1].length > 1);
    if (!populated.length) throw new ApiError("No supported data rows were found.");
    const rowCount = populated.reduce((total, [, rows]) => total + Math.max(0, rows.length - 1), 0);
    try { assertImportRowCount(rowCount); } catch { throw new ApiError(`The import is limited to ${MAX_ROWS} data rows per file. Split larger files into smaller batches.`, 413); }
    if (populated.some(([dataset]) => ["products", "stock", "suppliers"].includes(dataset)) && !roleMatchesAny(context.session.role, ["business_admin", "storekeeper"])) throw new ApiError("Inventory and supplier import requires an administrator or storekeeper role.", 403);
    if (populated.some(([dataset]) => ["customers", "patients"].includes(dataset)) && !roleMatchesAny(context.session.role, ["business_admin", "reception"])) throw new ApiError("Customer and patient import requires an administrator or reception role.", 403);
    if (populated.some(([dataset]) => dataset === "patients") && context.tenant.vertical !== "medical") throw new ApiError("Patient roster import is available only for medical workspaces.", 403);

    const errors: ImportError[] = [];
    const warnings: ImportError[] = [];
    const parsed = new Map<ImportDataset, ParsedRow[]>();
    const counts = emptyCounts();
    for (const [dataset, matrix] of populated) {
      const result = rowsToRecords(dataset, matrix);
      counts[dataset] = result.rows.length;
      for (const issue of result.errors) addError(errors, dataset, issue.row, new Error(issue.message));
      parsed.set(dataset, result.rows);
    }
    const defaultBranchId = String(form.get("branchId") ?? "").trim();
    const hasCustomers = parsed.has("customers") || parsed.has("patients");
    if (hasCustomers) {
      if (!defaultBranchId) addError(errors, parsed.has("patients") ? "patients" : "customers", 1, new Error("Choose the branch for imported customer/patient records."));
      else await requireBranchMembership(context, defaultBranchId);
    }
    const hasSuppliers = parsed.has("suppliers");
    if (hasSuppliers) await requireAllActiveBranchMemberships(context);
    const accessibleWarehouseIds = await getAccessibleWarehouseIds(context);
    const warehouses = accessibleWarehouseIds.length ? (await context.env.DB.prepare(`SELECT id, code, name, branch_id FROM inventory_warehouses WHERE tenant_id = ? AND is_active = 1 AND id IN (${accessibleWarehouseIds.map(() => "?").join(",")})`).bind(context.tenantId, ...accessibleWarehouseIds).all<WarehouseRow>()).results : [];
    const warehouseByCode = new Map<string, WarehouseRow>();
    for (const warehouse of warehouses) { warehouseByCode.set(normalizeCode(warehouse.code), warehouse); warehouseByCode.set(normalizeCode(warehouse.name), warehouse); }
    const defaultWarehouseId = String(form.get("warehouseId") ?? "").trim();
    if (defaultWarehouseId && !warehouses.some((warehouse) => warehouse.id === defaultWarehouseId)) throw new ApiError("The selected warehouse is not active or accessible to this account.", 403);

    const plannedProducts: PlannedProduct[] = [];
    const plannedCustomers: PlannedCustomer[] = [];
    const plannedSuppliers: PlannedSupplier[] = [];
    const plannedStock: PlannedStock[] = [];
    const productRows = parsed.get("products") ?? [];
    const customerRows = [...(parsed.get("customers") ?? []).map((row) => ({ ...row, dataset: "customers" as const })), ...(parsed.get("patients") ?? []).map((row) => ({ ...row, dataset: "patients" as const }))];
    const supplierRows = parsed.get("suppliers") ?? [];

    const productSkus = new Set<string>();
    const productBarcodes = new Set<string>();
    const productCandidates: PlannedProduct[] = [];
    for (const row of productRows) {
      try {
        const sku = textValue(row.values.sku, 48);
        const name = textValue(row.values.name, 120);
        if (!sku || !/^[a-zA-Z0-9._-]+$/.test(sku)) throw new Error("SKU is required and may contain only letters, digits, dot, underscore, and hyphen.");
        if (!name || name.length < 2) throw new Error("Product name must contain at least 2 characters.");
        const skuKey = normalizeCode(sku);
        if (productSkus.has(skuKey)) throw new Error("SKU is repeated inside this file.");
        productSkus.add(skuKey);
        const barcode = textValue(row.values.barcode, 80);
        const barcodeKey = barcode ? normalizeCode(barcode) : "";
        if (barcodeKey && productBarcodes.has(barcodeKey)) throw new Error("Barcode is repeated inside this file.");
        if (barcodeKey) productBarcodes.add(barcodeKey);
        const category = textValue(row.values.category, 80) ?? "General";
        const unitCode = textValue(row.values.unitCode, 24) ?? "piece";
        const quantityScaleRaw = numberValue(row.values.quantityScale, "Quantity scale", 4, true) ?? 0;
        if (!Number.isInteger(quantityScaleRaw)) throw new Error("Quantity scale must be an integer from 0 to 4.");
        const quantityScale = quantityScaleRaw;
        const tracksBatches = booleanValue(row.values.tracksBatches, "Track batches");
        const tracksExpiry = booleanValue(row.values.tracksExpiry, "Track expiry");
        if (tracksExpiry && !tracksBatches) throw new Error("Expiry tracking requires batch tracking.");
        const defaultCostMinor = moneyMinor(row.values.defaultCost, "Unit cost");
        const sellingPriceMinor = moneyMinor(row.values.sellingPrice, "Retail price");
        const wholesalePriceMinor = row.values.wholesalePrice?.trim() ? moneyMinor(row.values.wholesalePrice, "Wholesale price") : sellingPriceMinor;
        const distributorPriceMinor = row.values.distributorPrice?.trim() ? moneyMinor(row.values.distributorPrice, "Distributor price") : sellingPriceMinor;
        const reorderThreshold = quantityUnits(row.values.reorderThreshold, quantityScale, "Reorder threshold", true);
        const openingQuantity = quantityUnits(row.values.openingQuantity, quantityScale, "Opening quantity", true);
        const product: PlannedProduct = {
          id: crypto.randomUUID(), row: row.rowNumber, sku, barcode, name, description: textValue(row.values.description, 1000), category, unitCode,
          quantityScale, reorderThreshold, defaultCostMinor, sellingPriceMinor, wholesalePriceMinor, distributorPriceMinor,
          variantSize: textValue(row.values.variantSize, 32), variantColor: textValue(row.values.variantColor, 48), tracksBatches, tracksExpiry,
        };
        if (openingQuantity > 0) {
          const warehouseText = textValue(row.values.warehouseCode, 100);
          const warehouse = warehouseText ? warehouseByCode.get(normalizeCode(warehouseText)) : warehouses.find((candidate) => candidate.id === defaultWarehouseId);
          if (!warehouse) throw new Error("Opening stock requires an active accessible warehouse code, or a default warehouse selected in the form.");
          const lotNumber = textValue(row.values.lotNumber, 80);
          const expiresOn = dateValue(row.values.expiresOn, "Expiry date");
          if (tracksBatches && !lotNumber) throw new Error("Lot number is required for a batch-tracked product with opening stock.");
          if (tracksExpiry && !expiresOn) throw new Error("Expiry date is required for an expiry-tracked product with opening stock.");
          if (!tracksBatches && (lotNumber || expiresOn)) throw new Error("Lot and expiry fields are allowed only for batch-tracked products.");
          if (tracksExpiry && expiresOn && expiresOn < new Date().toISOString().slice(0, 10)) throw new Error("An expired lot cannot be added as opening stock.");
          product.opening = { warehouseId: warehouse.id, quantityUnits: openingQuantity, unitCostMinor: defaultCostMinor, lotNumber, expiresOn, row: row.rowNumber };
        }
        productCandidates.push(product);
      } catch (error) { addError(errors, "products", row.rowNumber, error); }
    }

    const customerPhones = new Set<string>();
    for (const row of customerRows) {
      const dataset = row.dataset;
      try {
        const fullName = textValue(row.values.fullName, 120);
        const phone = textValue(row.values.phone, 32);
        if (!fullName || fullName.length < 2) throw new Error("Full name must contain at least 2 characters.");
        const validPhone = phoneSchema.safeParse(phone);
        if (!phone || !validPhone.success) throw new Error("Phone must contain 6–32 digits or common phone characters.");
        const phoneKey = normalizePhone(phone);
        if (!phoneKey || customerPhones.has(phoneKey)) throw new Error("Phone number is repeated or invalid inside this file.");
        customerPhones.add(phoneKey);
        const email = textValue(row.values.email, 254)?.toLocaleLowerCase() ?? null;
        if (email && !z.string().email().safeParse(email).success) throw new Error("Email address is invalid.");
        const dateOfBirth = dateValue(row.values.dateOfBirth, "Date of birth", false);
        const gender = parseGender(row.values.gender);
        const notes = dataset === "patients" ? null : textValue(row.values.notes, 2000);
        plannedCustomers.push({ id: crypto.randomUUID(), dataset, row: row.rowNumber, fullName, phone: phone.trim(), email, gender, dateOfBirth, notes });
      } catch (error) { addError(errors, dataset, row.rowNumber, error); }
    }

    const suppliersInFile = new Set<string>();
    for (const row of supplierRows) {
      try {
        const name = textValue(row.values.name, 120);
        if (!name || name.length < 2) throw new Error("Supplier name must contain at least 2 characters.");
        const contactName = textValue(row.values.contactName, 120);
        const phone = textValue(row.values.phone, 32);
        const email = textValue(row.values.email, 254)?.toLocaleLowerCase() ?? null;
        if (phone && !phoneSchema.safeParse(phone).success) throw new Error("Phone must contain 6–32 digits or common phone characters.");
        if (email && !z.string().email().safeParse(email).success) throw new Error("Email address is invalid.");
        const address = textValue(row.values.address, 300);
        const taxNumber = textValue(row.values.taxNumber, 80);
        const notes = textValue(row.values.notes, 2000);
        const fingerprint = taxNumber ? `tax:${normalizeCode(taxNumber)}` : phone ? `phone:${normalizePhone(phone)}` : email ? `email:${email}` : `name:${normalizeCode(name)}`;
        if (suppliersInFile.has(fingerprint)) throw new Error("Supplier is repeated inside this file.");
        suppliersInFile.add(fingerprint);
        plannedSuppliers.push({ id: crypto.randomUUID(), row: row.rowNumber, name, contactName, phone, email, address, taxNumber, notes });
      } catch (error) { addError(errors, "suppliers", row.rowNumber, error); }
    }

    const keys = [...productSkus];
    const requestedBarcodes = [...productBarcodes];
    const existingItems = keys.length || requestedBarcodes.length ? (await context.env.DB.prepare(`SELECT id, sku, barcode, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor FROM inventory_items WHERE tenant_id = ? AND (lower(sku) IN (${keys.length ? keys.map(() => "?").join(",") : "NULL"}) OR lower(barcode) IN (${requestedBarcodes.length ? requestedBarcodes.map(() => "?").join(",") : "NULL"}))`).bind(context.tenantId, ...keys, ...requestedBarcodes).all<InventoryRow & { barcode: string | null }>()).results : [];
    const existingSkuSet = new Set(existingItems.map((row) => normalizeCode(row.sku)));
    const existingBarcodes = new Set(existingItems.map((row) => row.barcode ? normalizeCode(row.barcode) : "").filter(Boolean));
    const newBarcodeSet = new Set<string>();
    for (const item of productCandidates) {
      if (existingSkuSet.has(normalizeCode(item.sku))) { warnings.push({ dataset: "products", row: item.row, message: "An item with this SKU already exists; it will be skipped." }); continue; }
      if (item.barcode && (existingBarcodes.has(normalizeCode(item.barcode)) || newBarcodeSet.has(normalizeCode(item.barcode)))) { addError(errors, "products", item.row, new Error("Barcode is already used by another item in this workspace.")); continue; }
      if (item.barcode) newBarcodeSet.add(normalizeCode(item.barcode));
      plannedProducts.push(item);
    }

    const existingPhoneRows = customerPhones.size ? (await context.env.DB.prepare(`SELECT phone FROM customers WHERE tenant_id = ? AND phone IS NOT NULL`).bind(context.tenantId).all<{ phone: string }>()).results : [];
    const existingPhoneSet = new Set(existingPhoneRows.map((row) => normalizePhone(row.phone)));
    const plannedCustomerRows: PlannedCustomer[] = [];
    const newlyImportedPhoneSet = new Set<string>();
    for (const customer of plannedCustomers) {
      const phoneKey = normalizePhone(customer.phone);
      if (existingPhoneSet.has(phoneKey)) { warnings.push({ dataset: customerRows.find((row) => row.rowNumber === customer.row && (row.dataset === "customers" || row.dataset === "patients"))?.dataset ?? "customers", row: customer.row, message: "A customer/patient with this phone already exists; it will be skipped." }); continue; }
      if (newlyImportedPhoneSet.has(phoneKey)) { addError(errors, "customers", customer.row, new Error("Phone number appears more than once in the imported customer/patient sheets.")); continue; }
      newlyImportedPhoneSet.add(phoneKey);
      plannedCustomerRows.push(customer);
    }

    const existingSupplierRows = supplierRows.length ? (await context.env.DB.prepare("SELECT name, phone, email, tax_number FROM suppliers WHERE tenant_id = ?").bind(context.tenantId).all<{ name: string; phone: string | null; email: string | null; tax_number: string | null }>()).results : [];
    const supplierKeys = new Set(existingSupplierRows.map((row) => row.tax_number ? `tax:${normalizeCode(row.tax_number)}` : row.phone ? `phone:${normalizePhone(row.phone)}` : row.email ? `email:${row.email.toLocaleLowerCase()}` : `name:${normalizeCode(row.name)}`));
    const plannedSupplierRows: PlannedSupplier[] = [];
    for (const supplier of plannedSuppliers) {
      const key = supplier.taxNumber ? `tax:${normalizeCode(supplier.taxNumber)}` : supplier.phone ? `phone:${normalizePhone(supplier.phone)}` : supplier.email ? `email:${supplier.email}` : `name:${normalizeCode(supplier.name)}`;
      if (supplierKeys.has(key)) { warnings.push({ dataset: "suppliers", row: supplier.row, message: "A supplier with the same tax number/contact/name already exists; it will be skipped." }); continue; }
      supplierKeys.add(key);
      plannedSupplierRows.push(supplier);
    }

    const stockItemMap = new Map<string, InventoryRow>();
    for (const item of existingItems) stockItemMap.set(normalizeCode(item.sku), item);
    for (const item of plannedProducts) stockItemMap.set(normalizeCode(item.sku), { id: item.id, sku: item.sku, quantity_scale: item.quantityScale, tracks_batches: Number(item.tracksBatches), tracks_expiry: Number(item.tracksExpiry), default_cost_minor: item.defaultCostMinor });
    const stockRows = parsed.get("stock") ?? [];
    const stockSkus = [...new Set(stockRows.map((row) => normalizeCode(row.values.sku ?? "")).filter(Boolean))].filter((sku) => !stockItemMap.has(sku));
    if (stockSkus.length) {
      const rows = (await context.env.DB.prepare(`SELECT id, sku, quantity_scale, tracks_batches, tracks_expiry, default_cost_minor FROM inventory_items WHERE tenant_id = ? AND lower(sku) IN (${stockSkus.map(() => "?").join(",")}) AND is_active = 1`).bind(context.tenantId, ...stockSkus).all<InventoryRow>()).results;
      for (const row of rows) stockItemMap.set(normalizeCode(row.sku), row);
    }
    const seenStockKeys = new Set<string>();
    for (const product of plannedProducts) if (product.opening) {
      const opening = product.opening;
      const uniqueKey = `${product.id}:${opening.warehouseId}:${opening.lotNumber ?? ""}`;
      seenStockKeys.add(uniqueKey);
      plannedStock.push({ id: crypto.randomUUID(), itemId: product.id, sku: product.sku, warehouseId: opening.warehouseId, quantityUnits: opening.quantityUnits, unitCostMinor: opening.unitCostMinor, lotNumber: opening.lotNumber, expiresOn: opening.expiresOn, row: opening.row });
    }
    for (const row of stockRows) {
      const dataset = "stock" as const;
      try {
        const sku = textValue(row.values.sku, 48);
        const item = sku ? stockItemMap.get(normalizeCode(sku)) : null;
        if (!item) throw new Error("SKU was not found in this workspace or imported products.");
        const warehouseText = textValue(row.values.warehouseCode, 100);
        const warehouse = warehouseText && warehouseByCode.get(normalizeCode(warehouseText)) || (!warehouseText ? warehouses.find((candidate) => candidate.id === defaultWarehouseId) : undefined);
        if (!warehouse) throw new Error("Choose an active accessible warehouse or provide its code/name.");
        const quantityInUnits = quantityUnits(row.values.quantity, item.quantity_scale, "Quantity", false);
        if (!Number.isSafeInteger(quantityInUnits) || quantityInUnits <= 0) throw new Error("Quantity must be greater than zero and match the item's quantity precision.");
        const lotNumber = textValue(row.values.lotNumber, 80);
        const expiresOn = dateValue(row.values.expiresOn, "Expiry date");
        if (item.tracks_batches && !lotNumber) throw new Error("Lot number is required for a batch-tracked item.");
        if (item.tracks_expiry && !expiresOn) throw new Error("Expiry date is required for an expiry-tracked item.");
        if (!item.tracks_batches && (lotNumber || expiresOn)) throw new Error("Lot and expiry data are allowed only for batch-tracked items.");
        if (item.tracks_expiry && expiresOn && expiresOn < new Date().toISOString().slice(0, 10)) throw new Error("Expired lots cannot be imported as on-hand stock.");
        const costText = row.values.unitCost?.trim();
        const unitCostMinor = costText ? moneyMinor(costText, "Unit cost") : item.default_cost_minor;
        const uniqueKey = `${item.id}:${warehouse.id}:${lotNumber ?? ""}`;
        if (seenStockKeys.has(uniqueKey)) throw new Error("The same item/warehouse/lot appears more than once in this file.");
        seenStockKeys.add(uniqueKey);
        plannedStock.push({ id: crypto.randomUUID(), itemId: item.id, sku: item.sku, warehouseId: warehouse.id, quantityUnits: quantityInUnits, unitCostMinor, lotNumber, expiresOn, row: row.rowNumber });
      } catch (error) { addError(errors, dataset, row.rowNumber, error); }
    }

    if ((parsed.has("products") || parsed.has("stock")) && !warehouses.length) addError(errors, "stock", 1, new Error("No active inventory warehouse is accessible. Create or select a warehouse first."));
    const summary: Summary = { inserted: emptyCounts(), skipped: emptyCounts(), rows: counts, errors, warnings };
    summary.inserted.products = plannedProducts.length;
    summary.skipped.products = Math.max(0, counts.products - plannedProducts.length - errors.filter((error) => error.dataset === "products").length);
    summary.inserted.stock = plannedStock.length;
    summary.skipped.stock = 0;
    summary.inserted.customers = plannedCustomerRows.filter((row) => row.dataset === "customers").length;
    summary.skipped.customers = Math.max(0, counts.customers - summary.inserted.customers - errors.filter((error) => error.dataset === "customers").length);
    summary.inserted.patients = plannedCustomerRows.filter((row) => row.dataset === "patients").length;
    summary.skipped.patients = Math.max(0, counts.patients - summary.inserted.patients - errors.filter((error) => error.dataset === "patients").length);
    summary.inserted.suppliers = plannedSupplierRows.length;
    summary.skipped.suppliers = Math.max(0, counts.suppliers - plannedSupplierRows.length - errors.filter((error) => error.dataset === "suppliers").length);

    if (mode === "preview") return Response.json({ summary, branchRequired: hasCustomers, warehouseRequired: plannedStock.length > 0 }, { headers: { "Cache-Control": "no-store" } });
    if (errors.length) return Response.json({ error: "Fix the validation errors before importing. No data was written.", summary }, { status: 422, headers: { "Cache-Control": "no-store" } });
    if (!idempotencyKey.success) throw new ApiError("A valid idempotency key is required to import this file.");
    const canonicalData = { datasets: [...parsed.entries()].map(([dataset, rows]) => [dataset, rows.map((row) => row.values)]), branchId: defaultBranchId || null, warehouseId: defaultWarehouseId || null };
    const payloadHash = await sha256Hex(JSON.stringify(canonicalData));
    const jobKey = `upload:${idempotencyKey.data}`;
    const d1 = context.env.DB;
    const replay = await d1.prepare("SELECT id, payload_hash, result_json FROM data_import_jobs WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(context.tenantId, jobKey).first<{ id: string; payload_hash: string; result_json: string }>();
    if (replay) {
      if (replay.payload_hash !== payloadHash) throw new ApiError("This idempotency key was already used for a different file.", 409);
      let replayResult: unknown = {};
      try { replayResult = JSON.parse(replay.result_json); } catch { replayResult = {}; }
      return Response.json({ ...((replayResult && typeof replayResult === "object") ? replayResult : {}), replayed: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const statements: D1PreparedStatement[] = [];
    const now = nowUnix();
    for (const item of plannedProducts) statements.push(d1.prepare("INSERT INTO inventory_items (id, tenant_id, sku, barcode, name, description, category, unit_code, quantity_scale, reorder_threshold, default_cost_minor, selling_price_minor, wholesale_price_minor, distributor_price_minor, variant_group_id, variant_size, variant_color, tracks_batches, tracks_expiry, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)")
      .bind(item.id, context.tenantId, item.sku, item.barcode, item.name, item.description, item.category, item.unitCode, item.quantityScale, item.reorderThreshold, item.defaultCostMinor, item.sellingPriceMinor, item.wholesalePriceMinor, item.distributorPriceMinor, item.variantSize, item.variantColor, item.tracksBatches ? 1 : 0, item.tracksExpiry ? 1 : 0, now, now));
    for (const customer of plannedCustomerRows) {
      const origin = customerRows.find((row) => row.dataset === customer.dataset && row.rowNumber === customer.row);
      const branchId = defaultBranchId;
      if (!origin) throw new ApiError("Internal import mapping error.", 500);
      statements.push(d1.prepare("INSERT INTO customers (id, tenant_id, branch_id, full_name, phone, email, notes, date_of_birth, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(customer.id, context.tenantId, branchId, customer.fullName, customer.phone, customer.email, customer.notes, customer.dateOfBirth, customer.gender, now, now));
    }
    for (const supplier of plannedSupplierRows) statements.push(d1.prepare("INSERT INTO suppliers (id, tenant_id, name, contact_name, phone, email, address, tax_number, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .bind(supplier.id, context.tenantId, supplier.name, supplier.contactName, supplier.phone, supplier.email, supplier.address, supplier.taxNumber, supplier.notes, now, now));

    const operationId = plannedStock.length ? crypto.randomUUID() : null;
    const operationKey = jobKey;
    if (operationId) statements.push(d1.prepare("INSERT INTO stock_operations (id, tenant_id, operation_type, idempotency_key, reference_type, reference_id, created_by, notes, metadata_json, created_at) VALUES (?, ?, 'adjustment', ?, 'data_import', ?, ?, ?, ?, ?)")
      .bind(operationId, context.tenantId, operationKey, operationId, context.user.id, "Opening stock imported from a file", JSON.stringify({ payloadHash, movementCount: plannedStock.length }), now));

    const batchMap = new Map<string, { id: string; itemId: string; lotNumber: string; expiresOn: string | null; insert: boolean }>();
    const lotKeys = plannedStock.filter((stock) => stock.lotNumber).map((stock) => ({ itemId: stock.itemId, lotNumber: stock.lotNumber! }));
    const existingBatches = lotKeys.length ? (await d1.prepare(`SELECT id, item_id, lot_number, expires_on FROM inventory_batches WHERE tenant_id = ? AND (${lotKeys.map(() => "(item_id = ? AND lot_number = ?)").join(" OR ")})`).bind(context.tenantId, ...lotKeys.flatMap((lot) => [lot.itemId, lot.lotNumber])).all<{ id: string; item_id: string; lot_number: string; expires_on: string | null }>()).results : [];
    for (const stock of plannedStock) if (stock.lotNumber) {
      const existingBatch = existingBatches.find((batch) => batch.item_id === stock.itemId && batch.lot_number === stock.lotNumber);
      if (existingBatch && existingBatch.expires_on !== stock.expiresOn) addError(errors, "stock", stock.row, new Error("The expiry date for this existing lot does not match."));
      const key = `${stock.itemId}:${stock.lotNumber}`;
      const cached = batchMap.get(key);
      if (cached && cached.expiresOn !== stock.expiresOn) addError(errors, "stock", stock.row, new Error("The same lot was assigned conflicting expiry dates."));
      else if (!cached) batchMap.set(key, { id: existingBatch?.id ?? crypto.randomUUID(), itemId: stock.itemId, lotNumber: stock.lotNumber, expiresOn: stock.expiresOn, insert: !existingBatch });
    }
    if (errors.length) return Response.json({ error: "Fix the validation errors before importing. No data was written.", summary: { ...summary, errors } }, { status: 422, headers: { "Cache-Control": "no-store" } });
    for (const batch of batchMap.values()) if (batch.insert) statements.push(d1.prepare("INSERT INTO inventory_batches (id, tenant_id, item_id, lot_number, expires_on, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(batch.id, context.tenantId, batch.itemId, batch.lotNumber, batch.expiresOn, now, now));
    for (const stock of plannedStock) {
      const batchId = stock.lotNumber ? batchMap.get(`${stock.itemId}:${stock.lotNumber}`)?.id ?? null : null;
      if (stock.lotNumber) statements.push(createBalanceStatementByLot(d1, { id: crypto.randomUUID(), tenantId: context.tenantId, itemId: stock.itemId, warehouseId: stock.warehouseId, lotNumber: stock.lotNumber }));
      else statements.push(createBalanceStatement(d1, { id: crypto.randomUUID(), tenantId: context.tenantId, itemId: stock.itemId, warehouseId: stock.warehouseId, batchId: null }));
      statements.push(d1.prepare("INSERT INTO stock_movements (id, tenant_id, operation_id, item_id, warehouse_id, batch_id, movement_type, quantity_delta, unit_cost_minor, reference_type, reference_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'adjustment', ?, ?, 'data_import', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), context.tenantId, operationId, stock.itemId, stock.warehouseId, batchId, stock.quantityUnits, stock.unitCostMinor, operationId, `Import opening stock for ${stock.sku}`, context.user.id, now));
    }

    const jobId = crypto.randomUUID();
    const resultBody = { summary: { inserted: summary.inserted, skipped: summary.skipped, rows: summary.rows, warnings: summary.warnings }, importedAt: new Date().toISOString(), jobId };
    statements.push(d1.prepare("INSERT INTO data_import_jobs (id, tenant_id, idempotency_key, payload_hash, result_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(jobId, context.tenantId, jobKey, payloadHash, JSON.stringify(resultBody), context.user.id, now));
    if (statements.length > 900) throw new ApiError("This file creates too many database operations; split it into smaller files.", 413);
    try {
      await d1.batch(statements);
    } catch (error) {
      const concurrent = await d1.prepare("SELECT id, payload_hash, result_json FROM data_import_jobs WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1").bind(context.tenantId, jobKey).first<{ id: string; payload_hash: string; result_json: string }>();
      if (concurrent) {
        if (concurrent.payload_hash !== payloadHash) throw new ApiError("This idempotency key was already used for a different file.", 409);
        return Response.json({ ...JSON.parse(concurrent.result_json), replayed: true }, { headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    await writeAudit(context, request, "data.imported", "data_import_job", jobId, { inserted: summary.inserted, skipped: summary.skipped, rowCount });
    return Response.json(resultBody, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Unable to import the file. No partial data should have been written.");
  }
}
