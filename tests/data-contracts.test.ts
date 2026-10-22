import assert from "node:assert/strict";
import test from "node:test";
import { DATA_CONTRACT_LIMITS, EXPORT_DATASETS, parseExportPagination, assertImportRowCount } from "../lib/operations/data-contracts";
import { createXlsxExport, parseXlsx, rowsToRecords, getTemplateHeaders } from "../lib/operations/data-portability";

test("export pagination has explicit defaults and rejects unbounded pages", () => {
  assert.deepEqual(parseExportPagination(null, null), { page: 1, pageSize: DATA_CONTRACT_LIMITS.maxExportRows, offset: 0 });
  assert.deepEqual(parseExportPagination("2", "100"), { page: 2, pageSize: 100, offset: 100 });
  assert.throws(() => parseExportPagination("0", "100"), /positive integer/);
  assert.throws(() => parseExportPagination("1", "1001"), /1 to 1000/);
});

test("import row boundary is executable and rejects the next row", () => {
  assert.doesNotThrow(() => assertImportRowCount(DATA_CONTRACT_LIMITS.maxImportRows));
  assert.throws(() => assertImportRowCount(DATA_CONTRACT_LIMITS.maxImportRows + 1), /250/);
});

test("critical export dataset contract exposes the required operational datasets", () => {
  assert.deepEqual(EXPORT_DATASETS, ["inventory", "invoices", "customers", "reports", "purchases", "suppliers", "movements", "payments", "units"]);
});

test("products workbook round-trips through the importer contract", () => {
  const headers = getTemplateHeaders("products", "en");
  const workbook = createXlsxExport(headers, [["SKU-1", "", "Unit test product", "General", "piece", 0, 0, 1, 2, 2, 2, "", "", "no", "no", "", 0, "", "", ""]], "products");
  const sheets = parseXlsx(workbook);
  const parsed = rowsToRecords("products", sheets.products ?? []);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0]?.values.sku, "SKU-1");
});
