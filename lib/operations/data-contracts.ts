export const DATA_CONTRACT_LIMITS = {
  maxExportRows: 10_000,
  maxExportPageSize: 1_000,
  maxImportFileBytes: 5 * 1024 * 1024,
  maxImportMultipartBytes: 5 * 1024 * 1024 + 128 * 1024,
  maxImportRows: 250,
  maxImportErrors: 100,
} as const;

export const EXPORT_DATASETS = [
  "inventory",
  "invoices",
  "customers",
  "reports",
  "purchases",
  "suppliers",
  "movements",
  "payments",
  "units",
] as const;

export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export type ExportPagination = {
  page: number;
  pageSize: number;
  offset: number;
};

/** Parse one-indexed export pagination without allowing an unbounded query. */
export function parseExportPagination(pageValue: string | null, pageSizeValue: string | null): ExportPagination {
  const page = pageValue === null || pageValue === "" ? 1 : Number(pageValue);
  const isDefaultPageSize = pageSizeValue === null || pageSizeValue === "";
  const pageSize = isDefaultPageSize ? DATA_CONTRACT_LIMITS.maxExportRows : Number(pageSizeValue);
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("page must be a positive integer.");
  const maxPageSize = isDefaultPageSize ? DATA_CONTRACT_LIMITS.maxExportRows : DATA_CONTRACT_LIMITS.maxExportPageSize;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new Error(`pageSize must be an integer from 1 to ${maxPageSize}.`);
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset) || offset > Number.MAX_SAFE_INTEGER - pageSize) throw new Error("page is outside the supported range.");
  return { page, pageSize, offset };
}

export function exportPageLimit(pageSize: number): number {
  return Math.min(pageSize, DATA_CONTRACT_LIMITS.maxExportPageSize);
}

export function hasNextExportPage(rowCount: number, pageSize: number): boolean {
  return rowCount > pageSize;
}

export function assertImportRowCount(rowCount: number): void {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > DATA_CONTRACT_LIMITS.maxImportRows) {
    throw new Error(`The import is limited to ${DATA_CONTRACT_LIMITS.maxImportRows} data rows per file.`);
  }
}
