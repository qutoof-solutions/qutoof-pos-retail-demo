import { and, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  customerCheques,
  invoicePayments,
  invoices,
  inventoryWarehouses,
  purchaseInvoices,
  shiftSettlementLines,
  supplierCheques,
  treasuryTransactions,
  zReportSnapshots,
} from "@/lib/db/schema";

export const Z_REPORT_SCHEMA_VERSION = 1;

type Settlement = {
  id: string;
  tenantId: string;
  branchId: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openingCashMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  cashDifferenceMinor: number | null;
  electronicTotalMinor: number;
};

type SourceTimestampPolicy = {
  payments: "invoice_payments.created_at";
  treasury: "treasury_transactions.created_at";
  incomingCheques: "customer_cheques.created_at";
  outgoingCheques: "supplier_cheques.created_at";
};

export type ZReportPayload = {
  schemaVersion: number;
  settlementId: string;
  branchId: string;
  interval: { from: string; to: string; timezone: string; inclusiveFrom: true; exclusiveTo: true };
  sourceTimestampPolicy: SourceTimestampPolicy;
  shift: {
    openingCashMinor: number;
    expectedCashMinor: number;
    countedCashMinor: number;
    cashDifferenceMinor: number;
    electronicTotalMinor: number;
    collectedTotalMinor: number;
    lines: Array<{ paymentMethod: string; expectedMinor: number; collectedMinor: number; differenceMinor: number; invoiceCount: number }>;
    payments: Array<{ id: string; invoiceId: string; paymentMethod: string; amountMinor: number; createdAt: string }>;
  };
  treasury: {
    events: Array<{ id: string; direction: string; amountMinor: number; category: string; currency: string; reversalOfId: string | null; createdAt: string }>;
    totals: { incomingMinor: number; outgoingMinor: number; reversalIncomingMinor: number; reversalOutgoingMinor: number; netMinor: number };
  };
  cheques: {
    incoming: { count: number; totalMinor: number; byStatus: Record<string, number> };
    outgoing: { count: number; totalMinor: number; byStatus: Record<string, number> };
  };
  custody: {
    openingCashMinor: number;
    expectedCashMinor: number;
    countedCashMinor: number;
    cashDifferenceMinor: number;
    electronicTotalMinor: number;
  };
};

export type StoredZReportSnapshot = {
  id: string;
  payloadHash: string;
  payload: ZReportPayload;
  createdAt: Date;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function iso(value: Date | number): string { return new Date(value).toISOString(); }
function number(value: unknown): number { return Number(value ?? 0) || 0; }
function signed(direction: string, amountMinor: number): number { return direction === "out" ? -amountMinor : amountMinor; }

export function summarizeTreasury(events: Array<{ direction: string; amountMinor: number; reversalOfId: string | null }>) {
  return events.reduce((totals, row) => {
    const amount = row.amountMinor;
    if (row.reversalOfId) {
      if (row.direction === "out") totals.reversalOutgoingMinor += amount;
      else totals.reversalIncomingMinor += amount;
    }
    if (row.direction === "out") totals.outgoingMinor += amount;
    else totals.incomingMinor += amount;
    totals.netMinor += signed(row.direction, amount);
    return totals;
  }, { incomingMinor: 0, outgoingMinor: 0, reversalIncomingMinor: 0, reversalOutgoingMinor: 0, netMinor: 0 });
}

export function summarizeChequeStatuses(rows: Array<{ status: string; amountMinor: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => { result[row.status] = (result[row.status] ?? 0) + row.amountMinor; return result; }, {});
}

export async function createZReportSnapshot({
  db,
  tenantId,
  generatedBy,
  timezone,
  settlement,
}: {
  db: ReturnType<typeof getDb>;
  tenantId: string;
  generatedBy: string;
  timezone: string;
  settlement: Settlement;
}): Promise<StoredZReportSnapshot> {
  const existing = await db.select().from(zReportSnapshots).where(and(eq(zReportSnapshots.tenantId, tenantId), eq(zReportSnapshots.settlementId, settlement.id))).limit(1);
  if (existing[0]) return stored(existing[0]);
  if (!settlement.branchId || !settlement.closedAt) throw new Error("A closed branch settlement is required for a Z-report snapshot");

  const from = settlement.openedAt.getTime();
  const to = settlement.closedAt.getTime();
  const [payments, treasury, incomingCheques, outgoingCheques, lines] = await Promise.all([
    db.select({ id: invoicePayments.id, invoiceId: invoicePayments.invoiceId, paymentMethod: invoicePayments.paymentMethod, amountMinor: invoicePayments.amountMinor, createdAt: invoicePayments.createdAt })
      .from(invoicePayments)
      .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
      .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoices.branchId, settlement.branchId), gte(invoicePayments.createdAt, settlement.openedAt), lt(invoicePayments.createdAt, settlement.closedAt), isNull(invoicePayments.reversedAt), ne(invoices.status, "void")))
      .orderBy(invoicePayments.createdAt, invoicePayments.id),
    db.select({ id: treasuryTransactions.id, direction: treasuryTransactions.direction, amountMinor: treasuryTransactions.amountMinor, category: treasuryTransactions.category, currency: treasuryTransactions.currency, reversalOfId: treasuryTransactions.reversalOfId, createdAt: treasuryTransactions.createdAt })
      .from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.tenantId, tenantId), eq(treasuryTransactions.branchId, settlement.branchId), gte(treasuryTransactions.createdAt, settlement.openedAt), lt(treasuryTransactions.createdAt, settlement.closedAt)))
      .orderBy(treasuryTransactions.createdAt, treasuryTransactions.id),
    db.select({ id: customerCheques.id, amountMinor: customerCheques.amountMinor, status: customerCheques.status, createdAt: customerCheques.createdAt })
      .from(customerCheques)
      .where(and(eq(customerCheques.tenantId, tenantId), eq(customerCheques.branchId, settlement.branchId), gte(customerCheques.createdAt, settlement.openedAt), lt(customerCheques.createdAt, settlement.closedAt)))
      .orderBy(customerCheques.createdAt, customerCheques.id),
    db.select({ id: supplierCheques.id, amountMinor: supplierCheques.amountMinor, status: supplierCheques.status, createdAt: supplierCheques.createdAt })
      .from(supplierCheques)
      .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.id, supplierCheques.purchaseInvoiceId), eq(purchaseInvoices.tenantId, tenantId)))
      .innerJoin(inventoryWarehouses, and(eq(inventoryWarehouses.id, purchaseInvoices.warehouseId), eq(inventoryWarehouses.tenantId, tenantId)))
      .where(and(eq(supplierCheques.tenantId, tenantId), eq(inventoryWarehouses.branchId, settlement.branchId), gte(supplierCheques.createdAt, settlement.openedAt), lt(supplierCheques.createdAt, settlement.closedAt)))
      .orderBy(supplierCheques.createdAt, supplierCheques.id),
    db.select().from(shiftSettlementLines).where(and(eq(shiftSettlementLines.tenantId, tenantId), eq(shiftSettlementLines.settlementId, settlement.id))).orderBy(shiftSettlementLines.paymentMethod),
  ]);
  const treasuryEvents = treasury.map((row) => ({ id: row.id, direction: row.direction, amountMinor: number(row.amountMinor), category: row.category, currency: row.currency, reversalOfId: row.reversalOfId, createdAt: iso(row.createdAt) }));
  const treasuryTotals = summarizeTreasury(treasuryEvents);
  const linesPayload = lines.map((line) => ({ paymentMethod: line.paymentMethod, expectedMinor: number(line.expectedMinor), collectedMinor: number(line.collectedMinor), differenceMinor: number(line.differenceMinor), invoiceCount: number(line.invoiceCount) }));
  const collectedTotalMinor = linesPayload.reduce((total, line) => total + line.collectedMinor, 0);
  const payload: ZReportPayload = {
    schemaVersion: Z_REPORT_SCHEMA_VERSION,
    settlementId: settlement.id,
    branchId: settlement.branchId,
    interval: { from: iso(from), to: iso(to), timezone, inclusiveFrom: true, exclusiveTo: true },
    sourceTimestampPolicy: { payments: "invoice_payments.created_at", treasury: "treasury_transactions.created_at", incomingCheques: "customer_cheques.created_at", outgoingCheques: "supplier_cheques.created_at" },
    shift: {
      openingCashMinor: number(settlement.openingCashMinor), expectedCashMinor: number(settlement.expectedCashMinor), countedCashMinor: number(settlement.countedCashMinor), cashDifferenceMinor: number(settlement.cashDifferenceMinor), electronicTotalMinor: number(settlement.electronicTotalMinor), collectedTotalMinor,
      lines: linesPayload,
      payments: payments.map((row) => ({ id: row.id, invoiceId: row.invoiceId, paymentMethod: row.paymentMethod, amountMinor: number(row.amountMinor), createdAt: iso(row.createdAt) })),
    },
    treasury: { events: treasuryEvents, totals: treasuryTotals },
    cheques: {
      incoming: { count: incomingCheques.length, totalMinor: incomingCheques.reduce((total, row) => total + number(row.amountMinor), 0), byStatus: summarizeChequeStatuses(incomingCheques.map((row) => ({ status: row.status, amountMinor: number(row.amountMinor) }))) },
      outgoing: { count: outgoingCheques.length, totalMinor: outgoingCheques.reduce((total, row) => total + number(row.amountMinor), 0), byStatus: summarizeChequeStatuses(outgoingCheques.map((row) => ({ status: row.status, amountMinor: number(row.amountMinor) }))) },
    },
    custody: { openingCashMinor: number(settlement.openingCashMinor), expectedCashMinor: number(settlement.expectedCashMinor), countedCashMinor: number(settlement.countedCashMinor), cashDifferenceMinor: number(settlement.cashDifferenceMinor), electronicTotalMinor: number(settlement.electronicTotalMinor) },
  };
  const snapshotJson = canonicalJson(payload);
  const payloadHash = await sha256Hex(snapshotJson);
  const id = crypto.randomUUID();
  try {
    await db.insert(zReportSnapshots).values({ id, tenantId, branchId: settlement.branchId, settlementId: settlement.id, schemaVersion: Z_REPORT_SCHEMA_VERSION, generatedBy, closedAt: settlement.closedAt, idempotencyKey: `z-report:${settlement.id}`, payloadHash, snapshotJson, createdAt: new Date() }).run();
  } catch {
    const raced = await db.select().from(zReportSnapshots).where(and(eq(zReportSnapshots.tenantId, tenantId), eq(zReportSnapshots.settlementId, settlement.id))).limit(1);
    if (!raced[0]) throw new Error("Unable to persist Z-report snapshot");
    return stored(raced[0]);
  }
  return { id, payloadHash, payload, createdAt: new Date() };
}

function stored(row: typeof zReportSnapshots.$inferSelect): StoredZReportSnapshot {
  return { id: row.id, payloadHash: row.payloadHash, payload: JSON.parse(row.snapshotJson) as ZReportPayload, createdAt: row.createdAt };
}
