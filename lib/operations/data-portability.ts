import { unzipSync, zipSync } from "fflate";

export type DataLocale = "ar" | "en";
export type ImportDataset = "products" | "stock" | "customers" | "patients" | "suppliers";
export type ExportDataset = "inventory" | "invoices" | "customers" | "reports";
export type ParsedRow = { rowNumber: number; values: Record<string, string> };
export type ImportParseResult = { rows: ParsedRow[]; errors: Array<{ row: number; message: string }> };

const DATASETS: ImportDataset[] = ["products", "stock", "customers", "patients", "suppliers"];
const HEADER_LABELS: Record<ImportDataset, Record<DataLocale, Array<{ key: string; label: string }>>> = {
  products: {
    ar: [
      { key: "sku", label: "SKU / رمز الصنف" }, { key: "barcode", label: "Barcode / الباركود" }, { key: "name", label: "Name / اسم الصنف" },
      { key: "category", label: "Category / الفئة" }, { key: "unitCode", label: "Unit / الوحدة" }, { key: "quantityScale", label: "Quantity Scale / دقة الكمية" },
      { key: "reorderThreshold", label: "Reorder Threshold / حد إعادة الطلب" }, { key: "defaultCost", label: "Unit Cost / تكلفة الوحدة" },
      { key: "sellingPrice", label: "Retail Price / سعر القطاعي" }, { key: "wholesalePrice", label: "Wholesale Price / سعر الجملة" },
      { key: "distributorPrice", label: "Distributor Price / سعر الموزع" }, { key: "variantSize", label: "Size / المقاس" }, { key: "variantColor", label: "Color / اللون" },
      { key: "tracksBatches", label: "Track Batches / تتبع التشغيلات" }, { key: "tracksExpiry", label: "Track Expiry / تتبع الصلاحية" },
      { key: "description", label: "Description / الوصف" }, { key: "openingQuantity", label: "Opening Quantity / رصيد بداية" },
      { key: "warehouseCode", label: "Warehouse Code / رمز المخزن" }, { key: "lotNumber", label: "Lot Number / رقم التشغيلة" }, { key: "expiresOn", label: "Expires On / تاريخ الصلاحية" },
    ],
    en: [
      { key: "sku", label: "SKU" }, { key: "barcode", label: "Barcode" }, { key: "name", label: "Product Name" }, { key: "category", label: "Category" },
      { key: "unitCode", label: "Unit Code" }, { key: "quantityScale", label: "Quantity Scale" }, { key: "reorderThreshold", label: "Reorder Threshold" },
      { key: "defaultCost", label: "Unit Cost" }, { key: "sellingPrice", label: "Retail Price" }, { key: "wholesalePrice", label: "Wholesale Price" },
      { key: "distributorPrice", label: "Distributor Price" }, { key: "variantSize", label: "Size" }, { key: "variantColor", label: "Color" },
      { key: "tracksBatches", label: "Track Batches (yes/no)" }, { key: "tracksExpiry", label: "Track Expiry (yes/no)" }, { key: "description", label: "Description" },
      { key: "openingQuantity", label: "Opening Quantity" }, { key: "warehouseCode", label: "Warehouse Code" }, { key: "lotNumber", label: "Lot Number" }, { key: "expiresOn", label: "Expires On (YYYY-MM-DD)" },
    ],
  },
  stock: {
    ar: [{ key: "sku", label: "SKU / رمز الصنف" }, { key: "warehouseCode", label: "Warehouse Code / رمز المخزن" }, { key: "quantity", label: "Quantity / الكمية" }, { key: "unitCost", label: "Unit Cost / تكلفة الوحدة" }, { key: "lotNumber", label: "Lot Number / رقم التشغيلة" }, { key: "expiresOn", label: "Expires On / تاريخ الصلاحية" }],
    en: [{ key: "sku", label: "SKU" }, { key: "warehouseCode", label: "Warehouse Code" }, { key: "quantity", label: "Quantity" }, { key: "unitCost", label: "Unit Cost" }, { key: "lotNumber", label: "Lot Number" }, { key: "expiresOn", label: "Expires On (YYYY-MM-DD)" }],
  },
  customers: {
    ar: [{ key: "fullName", label: "Full Name / الاسم الكامل" }, { key: "phone", label: "Phone / الهاتف" }, { key: "email", label: "Email / البريد الإلكتروني" }, { key: "gender", label: "Gender / النوع" }, { key: "dateOfBirth", label: "Date of Birth / تاريخ الميلاد" }, { key: "notes", label: "Notes / ملاحظات" }],
    en: [{ key: "fullName", label: "Full Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "gender", label: "Gender (female/male/unspecified)" }, { key: "dateOfBirth", label: "Date of Birth (YYYY-MM-DD)" }, { key: "notes", label: "Notes" }],
  },
  patients: {
    ar: [{ key: "fullName", label: "Patient Name / اسم المريض" }, { key: "phone", label: "Phone / الهاتف" }, { key: "email", label: "Email / البريد الإلكتروني" }, { key: "gender", label: "Gender / النوع" }, { key: "dateOfBirth", label: "Date of Birth / تاريخ الميلاد" }, { key: "notes", label: "Notes / ملاحظات عامة" }],
    en: [{ key: "fullName", label: "Patient Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "gender", label: "Gender (female/male/unspecified)" }, { key: "dateOfBirth", label: "Date of Birth (YYYY-MM-DD)" }, { key: "notes", label: "General Notes" }],
  },
  suppliers: {
    ar: [{ key: "name", label: "Supplier Name / اسم المورد" }, { key: "contactName", label: "Contact Name / مسؤول التواصل" }, { key: "phone", label: "Phone / الهاتف" }, { key: "email", label: "Email / البريد الإلكتروني" }, { key: "address", label: "Address / العنوان" }, { key: "taxNumber", label: "Tax Number / الرقم الضريبي" }, { key: "notes", label: "Notes / ملاحظات" }],
    en: [{ key: "name", label: "Supplier Name" }, { key: "contactName", label: "Contact Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" }, { key: "taxNumber", label: "Tax Number" }, { key: "notes", label: "Notes" }],
  },
};

const ALIASES: Record<string, string[]> = {
  sku: ["sku", "item sku", "product sku", "رمز الصنف", "كود الصنف", "كود المنتج", "sku / رمز الصنف"],
  barcode: ["barcode", "bar code", "ean", "upc", "الباركود", "باركود", "barcode / الباركود"],
  name: ["name", "product name", "item name", "supplier name", "اسم", "الاسم", "اسم الصنف", "اسم المنتج", "اسم المورد", "supplier name / اسم المورد"],
  fullName: ["full name", "customer name", "patient name", "اسم العميل", "اسم المريض", "الاسم الكامل", "patient name / اسم المريض", "full name / الاسم الكامل"],
  category: ["category", "product category", "الفئة", "التصنيف"],
  unitCode: ["unit", "unit code", "الوحدة", "كود الوحدة"],
  quantityScale: ["quantity scale", "scale", "دقة الكمية", "منازل الكمية"],
  reorderThreshold: ["reorder threshold", "reorder level", "حد إعادة الطلب", "حد التنبيه"],
  defaultCost: ["unit cost", "cost", "default cost", "التكلفة", "تكلفة الوحدة"],
  sellingPrice: ["retail price", "selling price", "price", "سعر البيع", "سعر القطاعي"],
  wholesalePrice: ["wholesale price", "سعر الجملة"],
  distributorPrice: ["distributor price", "half wholesale price", "سعر الموزع", "نصف الجملة", "سعر نصف الجملة"],
  variantSize: ["size", "variant size", "المقاس", "الحجم"],
  variantColor: ["color", "colour", "variant color", "اللون"],
  tracksBatches: ["track batches", "tracks batches", "تتبع التشغيلات", "تتبع الدفعات"],
  tracksExpiry: ["track expiry", "tracks expiry", "تتبع الصلاحية", "تتبع تاريخ الصلاحية"],
  description: ["description", "الوصف", "وصف الصنف"],
  openingQuantity: ["opening quantity", "opening stock", "initial quantity", "الرصيد الافتتاحي", "رصيد بداية", "كمية البداية"],
  warehouseCode: ["warehouse code", "warehouse", "store code", "رمز المخزن", "كود المخزن", "المخزن"],
  lotNumber: ["lot number", "batch number", "lot", "رقم التشغيلة", "رقم الدفعة"],
  expiresOn: ["expires on", "expiry date", "expiration date", "تاريخ الصلاحية", "تاريخ الانتهاء"],
  quantity: ["quantity", "qty", "الكمية", "رصيد"],
  unitCost: ["unit cost", "تكلفة الوحدة", "تكلفة"],
  phone: ["phone", "mobile", "telephone", "الهاتف", "رقم الهاتف", "الموبايل", "الجوال"],
  email: ["email", "e-mail", "البريد الإلكتروني", "البريد الالكتروني"],
  gender: ["gender", "sex", "النوع", "الجنس"],
  dateOfBirth: ["date of birth", "birth date", "dob", "تاريخ الميلاد"],
  notes: ["notes", "ملاحظات", "ملاحظات عامة"],
  contactName: ["contact name", "contact person", "مسؤول التواصل", "اسم المسؤول", "جهة الاتصال"],
  address: ["address", "العنوان"],
  taxNumber: ["tax number", "tax id", "vat number", "الرقم الضريبي", "رقم التسجيل الضريبي"],
};

const REQUIRED_FIELDS: Record<ImportDataset, string[]> = {
  products: ["sku", "name"], stock: ["sku", "warehouseCode", "quantity"], customers: ["fullName", "phone"], patients: ["fullName", "phone"], suppliers: ["name"],
};

export function normalizeHeader(value: string): string {
  return value.normalize("NFKC").replace(/^\uFEFF/, "").replace(/[\u064B-\u065F\u0670\u0640]/g, "").trim().toLocaleLowerCase().replace(/[|/\\_\-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

const ALIAS_LOOKUP = new Map<string, string>();
for (const [field, aliases] of Object.entries(ALIASES)) for (const alias of aliases) ALIAS_LOOKUP.set(normalizeHeader(alias), field);
for (const dataset of DATASETS) for (const column of HEADER_LABELS[dataset].ar.concat(HEADER_LABELS[dataset].en)) ALIAS_LOOKUP.set(normalizeHeader(column.label), column.key);

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function xmlUnescape(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlEscape(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]!] = xmlUnescape(match[3]!);
  return result;
}
function assertSafeZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error("Invalid XLSX ZIP container.");
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (entries > 160 || cursor + directorySize > eocd) throw new Error("XLSX archive structure is not supported.");
  let totalUncompressed = 0;
  for (let count = 0; count < entries; count += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid XLSX directory entry.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (flags & 1) throw new Error("Encrypted XLSX files are not supported.");
    if (method !== 0 && method !== 8) throw new Error("Unsupported XLSX compression method.");
    if (uncompressed > 6_000_000 || (compressed > 0 && uncompressed / compressed > 250)) throw new Error("XLSX contains an oversized or highly compressed entry.");
    totalUncompressed += uncompressed;
    if (totalUncompressed > 18_000_000) throw new Error("XLSX expands beyond the allowed size.");
    const nameStart = cursor + 46;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..") || /vbaProject\.bin$/i.test(name)) throw new Error("Unsafe or macro-enabled XLSX entry.");
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
}
function columnNumber(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}
function parseWorksheet(xml: string, shared: string[]): string[][] {
  const result: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    let sequential = 0;
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cellMatch[1]!);
      const col = columnNumber(attrs.r ?? "") >= 0 ? columnNumber(attrs.r!) : sequential;
      sequential = col + 1;
      const body = cellMatch[2] ?? "";
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      if (attrs.t === "s") values[col] = shared[Number(value)] ?? "";
      else if (attrs.t === "inlineStr") values[col] = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1]!)).join("");
      else values[col] = xmlUnescape(value);
    }
    if (values.some((cell) => cell?.trim())) result.push(Array.from({ length: values.length }, (_, index) => values[index] ?? ""));
  }
  return result;
}

function datasetFromSheet(name: string): ImportDataset | null {
  const normalized = normalizeHeader(name);
  const names: Record<string, ImportDataset> = {
    products: "products", product: "products", items: "products", inventory: "products", "الأصناف": "products", "المنتجات": "products", "قائمة الأصناف": "products",
    stock: "stock", balances: "stock", "المخزون": "stock", "الأرصدة": "stock", "أرصدة المخزون": "stock",
    customers: "customers", customer: "customers", clients: "customers", "العملاء": "customers", "قائمة العملاء": "customers",
    patients: "patients", patient: "patients", "المرضى": "patients", "قائمة المرضى": "patients",
    suppliers: "suppliers", supplier: "suppliers", vendors: "suppliers", "الموردون": "suppliers", "الموردين": "suppliers",
  };
  return names[normalized] ?? null;
}

export function parseXlsx(bytes: Uint8Array): Partial<Record<ImportDataset, string[][]>> {
  assertSafeZip(bytes);
  const files = unzipSync(bytes);
  const decode = (name: string) => files[name] ? new TextDecoder().decode(files[name]) : "";
  const workbook = decode("xl/workbook.xml");
  const rels = decode("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("The XLSX workbook is missing required workbook metadata.");
  const relationshipTargets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)) {
    const attr = attributes(match[1]!);
    if (attr.Id && attr.Target) relationshipTargets.set(attr.Id, attr.Target.replace(/^\//, "").startsWith("xl/") ? attr.Target.replace(/^\//, "") : `xl/${attr.Target.replace(/^\//, "")}`);
  }
  const shared: string[] = [];
  const sharedXml = decode("xl/sharedStrings.xml");
  for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push([...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => xmlUnescape(part[1]!)).join(""));
  const result: Partial<Record<ImportDataset, string[][]>> = {};
  for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)) {
    const attr = attributes(match[1]!);
    const target = relationshipTargets.get(attr["r:id"] ?? "");
    if (!target) continue;
    const dataset = datasetFromSheet(attr.name ?? "");
    const rows = parseWorksheet(decode(target), shared);
    if (!dataset) { if (rows.length > 1) throw new Error(`Unknown data sheet: ${attr.name ?? "(unnamed)"}.`); continue; }
    if (result[dataset]) throw new Error(`The workbook contains duplicate ${dataset} sheets.`);
    result[dataset] = rows;
  }
  if (!Object.values(result).some((rows) => (rows?.length ?? 0) > 1)) throw new Error("The workbook has no supported data rows.");
  return result;
}

export function rowsToRecords(dataset: ImportDataset, matrix: string[][]): ImportParseResult {
  const errors: ImportParseResult["errors"] = [];
  const headerIndex = matrix.findIndex((row) => row.some((cell) => cell.trim()));
  if (headerIndex < 0 || matrix.length <= headerIndex + 1) return { rows: [], errors: [{ row: 1, message: "No header row or data rows were found." }] };
  const headerRow = matrix[headerIndex]!;
  const fieldByColumn = headerRow.map((header) => ALIAS_LOOKUP.get(normalizeHeader(header)) ?? null);
  const seen = new Set<string>();
  fieldByColumn.forEach((field, column) => {
    if (!field) return;
    if (seen.has(field)) errors.push({ row: headerIndex + 1, message: `The column ${headerRow[column]} is duplicated.` });
    seen.add(field);
  });
  const missing = REQUIRED_FIELDS[dataset].filter((field) => !seen.has(field));
  if (missing.length) errors.push({ row: headerIndex + 1, message: `Required column(s) missing: ${missing.join(", ")}.` });
  const rows: ParsedRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index]!;
    if (!cells.some((cell) => cell.trim())) continue;
    const values: Record<string, string> = {};
    fieldByColumn.forEach((field, column) => { if (field) values[field] = (cells[column] ?? "").trim(); });
    rows.push({ rowNumber: index + 1, values });
  }
  if (!rows.length) errors.push({ row: headerIndex + 1, message: "The sheet contains headers but no data rows." });
  return { rows, errors };
}

export function getTemplateHeaders(dataset: ImportDataset, locale: DataLocale): string[] { return HEADER_LABELS[dataset][locale].map((column) => column.label); }
export function getTemplateFields(dataset: ImportDataset): string[] { return HEADER_LABELS[dataset].en.map((column) => column.key); }

export function csvEncode(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function createCsvTemplate(dataset: ImportDataset, locale: DataLocale): string { return csvEncode([getTemplateHeaders(dataset, locale)]); }

export function createXlsxExport(headers: string[], rows: Array<Array<string | number | null | undefined>>, sheetName = "Export"): Uint8Array {
  const toColumnName = (index: number) => { let value = index + 1; let letters = ""; while (value) { const rem = (value - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; value = Math.floor((value - 1) / 26); } return letters; };
  const xmlCell = (row: number, column: number, value: string | number | null | undefined) => {
    const ref = `${toColumnName(column)}${row}`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" t="n"><v>${value}</v></c>`;
    const text = value === null || value === undefined ? "" : String(value);
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
  };
  const allRows = [headers, ...rows];
  const sheetRows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xmlCell(rowIndex + 1, columnIndex, value)).join("")}</row>`).join("");
  const safeSheetName = sheetName.replace(/[\\/?*:[\]]/g, " ").slice(0, 31) || "Export";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  return zipSync(files, { level: 6 });
}

export function createXlsxTemplate(locale: DataLocale): Uint8Array {
  const sheets = DATASETS.map((dataset, index) => ({ dataset, index: index + 1, headers: getTemplateHeaders(dataset, locale) }));
  const sheetXml = (headers: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headers.map((header, index) => {
    let col = index + 1; let letters = ""; while (col) { const rem = (col - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; col = Math.floor((col - 1) / 26); }
    return `<c r="${letters}1" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(header)}</t></is></c>`;
  }).join("")}</row></sheetData></worksheet>`;
  const contentOverrides = sheets.map((sheet) => `<Override PartName="/xl/worksheets/sheet${sheet.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetEntries = sheets.map((sheet) => `<sheet name="${sheet.dataset}" sheetId="${sheet.index}" r:id="rId${sheet.index}"/>`).join("");
  const relationships = sheets.map((sheet) => `<Relationship Id="rId${sheet.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.index}.xml"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentOverrides}</Types>`),
    "_rels/.rels": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`),
  };
  for (const sheet of sheets) files[`xl/worksheets/sheet${sheet.index}.xml`] = new TextEncoder().encode(sheetXml(sheet.headers));
  return zipSync(files, { level: 6 });
}
