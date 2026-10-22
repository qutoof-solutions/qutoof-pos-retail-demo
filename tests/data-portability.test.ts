import assert from "node:assert/strict";
import test from "node:test";
import { createXlsxExport, csvEncode, getTemplateHeaders, parseCsv, parseXlsx, rowsToRecords } from "@/lib/operations/data-portability";

test("CSV parser handles BOM, quoted commas, escaped quotes, and multiline cells", () => {
  const parsed = parseCsv('\uFEFFname,notes\r\n"Smith, Jane","said ""hello""\nand left"\r\n');
  assert.deepEqual(parsed, [["name", "notes"], ["Smith, Jane", 'said "hello"\nand left']]);
});

test("CSV template headers map in Arabic and English", () => {
  const arabic = rowsToRecords("products", [getTemplateHeaders("products", "ar"), ["SKU-1", "12345", "عباءة", "ملابس", "قطعة", "0", "2", "10", "25", "22", "20", "M", "أسود", "لا", "لا", "", "4", "WH-1", "", ""]]);
  assert.deepEqual(arabic.errors, []);
  assert.equal(arabic.rows[0]?.values.sku, "SKU-1");
  assert.equal(arabic.rows[0]?.values.name, "عباءة");
  assert.equal(arabic.rows[0]?.values.wholesalePrice, "22");

  const english = rowsToRecords("customers", [["Full Name", "Phone", "Email", "Gender", "Date of Birth", "Notes"], ["Rana Test", "+201000000000", "rana@example.com", "female", "1990-01-02", ""]]);
  assert.deepEqual(english.errors, []);
  assert.equal(english.rows[0]?.values.fullName, "Rana Test");
});

test("duplicate and missing column headers are reported without losing rows", () => {
  const result = rowsToRecords("stock", [["SKU", "SKU", "Quantity"], ["A-1", "A-2", "5"]]);
  assert.ok(result.errors.some((issue) => issue.message.includes("duplicated")));
  assert.ok(result.errors.some((issue) => issue.message.includes("missing")));
  assert.equal(result.rows.length, 1);
});

test("XLSX export is readable by the importer and keeps all cell text inert", () => {
  const headers = getTemplateHeaders("products", "en");
  const row = ["SKU-20", "1234567", "Test <script>", "General", "piece", 0, 0, 10.25, 12, 11, 10, "M", "Blue", "no", "no", "=1+1", 0, "", "", ""] as Array<string | number>;
  const workbook = createXlsxExport(headers, [row], "products");
  const sheets = parseXlsx(workbook);
  const parsed = rowsToRecords("products", sheets.products ?? []);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0]?.values.sku, "SKU-20");
  assert.equal(parsed.rows[0]?.values.name, "Test <script>");
  assert.equal(parsed.rows[0]?.values.description, "=1+1");
});

test("CSV exports escape formulas in string cells", () => {
  const csv = csvEncode([["name", "value", "negative-looking"], ["=HYPERLINK(\"https://example.invalid\")", 42, "-1+2"]]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"'-1\+2"/);
  const parsed = parseCsv(csv);
  assert.equal(parsed[1]?.[0], "'=HYPERLINK(\"https://example.invalid\")");
  assert.equal(parsed[1]?.[1], "42");
  assert.equal(parsed[1]?.[2], "'-1+2");
});
