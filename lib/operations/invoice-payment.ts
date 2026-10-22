import { ApiError } from "@/lib/operations/api-error";

type PaymentMethod = "cash" | "card" | "wallet" | "instapay";

type ExistingPayment = { invoiceId: string; payloadHash: string | null };
type D1Meta = { changes?: number };
type ContractRow = { status: string };

type InvoicePaymentInput = {
  db: D1Database;
  tenantId: string;
  invoiceId: string;
  userId: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  idempotencyKey: string;
  payloadHash: string;
  scheduleId?: string | null;
  applySchedules?: boolean;
  now?: Date;
};

export type InvoicePaymentResult = { paymentId: string; replayed: boolean };

type ScheduleRow = { id: string; amountMinor: number; paidMinor: number };
export type ScheduleAllocation = { id: string; amountMinor: number };

async function findExistingPayment(db: D1Database, tenantId: string, idempotencyKey: string): Promise<ExistingPayment | null> {
  return db.prepare("SELECT invoice_id AS invoiceId, idempotency_payload_hash AS payloadHash FROM invoice_payments WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1")
    .bind(tenantId, idempotencyKey).first<ExistingPayment>();
}

function assertMatchingReplay(existing: ExistingPayment | null, input: InvoicePaymentInput): InvoicePaymentResult | null {
  if (!existing) return null;
  if (existing.invoiceId !== input.invoiceId || existing.payloadHash !== input.payloadHash) throw new ApiError("مفتاح الدفعة مستخدم لعملية دفع مختلفة؛ أنشئ عملية جديدة", 409);
  return { paymentId: "", replayed: true };
}

export async function applyInvoicePayment(input: InvoicePaymentInput): Promise<InvoicePaymentResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw new ApiError("يجب أن يكون مبلغ الدفعة قرشاً واحداً على الأقل");
  const existing = assertMatchingReplay(await findExistingPayment(input.db, input.tenantId, input.idempotencyKey), input);
  if (existing) return existing;

  const now = input.now ?? new Date();
  const paymentId = crypto.randomUUID();
  const scheduleRows = input.applySchedules === false ? [] : await loadSchedules(input);
  if (input.applySchedules !== false) {
    const contract = await loadInstallmentContract(input);
    if (contract && contract.status !== "active") {
      throw new ApiError("لا يمكن التحصيل من عقد تقسيط غير نشط؛ ألغِ التوزيع أو أنشئ عقداً نشطاً", 409);
    }
    if (contract && !scheduleRows.length) {
      throw new ApiError("لا توجد أقساط نشطة غير مسددة لهذا العقد", 409);
    }
  }
  const remainingScheduleMinor = scheduleRows.reduce((total, row) => total + row.amountMinor - row.paidMinor, 0);
  if (scheduleRows.length && input.amountMinor > remainingScheduleMinor) throw new ApiError("مبلغ الدفعة يتجاوز إجمالي الأقساط المتبقية", 409);
  const allocations = allocateSchedulePayments(input.amountMinor, scheduleRows);
  const invoiceUpdateSql = "UPDATE invoices SET paid_minor = paid_minor + ?, payment_method = CASE WHEN paid_minor = 0 THEN ? WHEN payment_method = ? THEN payment_method ELSE 'mixed' END, status = CASE WHEN paid_minor + ? >= total_minor THEN 'paid' ELSE 'partially_paid' END, paid_at = CASE WHEN paid_minor + ? >= total_minor THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('issued', 'partially_paid') AND paid_minor + ? <= total_minor - COALESCE((SELECT SUM(c.amount_minor) FROM customer_cheques c WHERE c.tenant_id = ? AND c.invoice_id = invoices.id AND c.status = 'pending'), 0)";
  const snapshotPredicates = input.applySchedules === false || !allocations.length ? [] : allocations.map(() => "EXISTS (SELECT 1 FROM installment_schedules s WHERE s.id = ? AND s.tenant_id = ? AND s.invoice_id = invoices.id AND s.status = 'unpaid' AND s.amount_minor = ? AND s.paid_minor = ?)");
  const invoiceUpdateSqlWithSnapshot = input.applySchedules === false || !allocations.length
    ? invoiceUpdateSql
    : `${invoiceUpdateSql} AND (NOT EXISTS (SELECT 1 FROM installment_contracts c WHERE c.tenant_id = ? AND c.invoice_id = invoices.id) OR (${snapshotPredicates.join(" AND ")} AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.tenant_id = ? AND c.invoice_id = invoices.id AND c.status = 'active')))`;
  const snapshotBindings = input.applySchedules === false || !allocations.length ? [] : [
    input.tenantId,
    ...allocations.flatMap((allocation) => {
      const row = scheduleRows.find((candidate) => candidate.id === allocation.id);
      return [allocation.id, input.tenantId, row?.amountMinor ?? 0, row?.paidMinor ?? 0];
    }),
    input.tenantId,
  ];
  const invoiceUpdate = input.db.prepare(invoiceUpdateSqlWithSnapshot)
    .bind(...[input.amountMinor, input.method, input.method, input.amountMinor, input.amountMinor, now.getTime(), now.getTime(), input.invoiceId, input.tenantId, input.amountMinor, input.tenantId, ...snapshotBindings]);
  const statements = [invoiceUpdate];
  for (const allocation of allocations) {
    statements.push(input.db.prepare("UPDATE installment_schedules SET paid_minor = paid_minor + ?, status = CASE WHEN paid_minor + ? >= amount_minor THEN 'paid' ELSE 'unpaid' END, paid_at = CASE WHEN paid_minor + ? >= amount_minor THEN ? ELSE NULL END, paid_by = ?, payment_method = ?, reference = ?, updated_at = ? WHERE changes() = 1 AND id = ? AND tenant_id = ? AND invoice_id = ? AND status = 'unpaid' AND paid_minor + ? <= amount_minor AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id = installment_schedules.contract_id AND c.tenant_id = ? AND c.invoice_id = installment_schedules.invoice_id AND c.status = 'active')")
      .bind(allocation.amountMinor, allocation.amountMinor, allocation.amountMinor, now.getTime(), input.userId, input.method, input.reference, now.getTime(), allocation.id, input.tenantId, input.invoiceId, allocation.amountMinor, input.tenantId));
  }
  const paymentInsert = input.db.prepare("INSERT INTO invoice_payments (id, tenant_id, invoice_id, received_by, amount_minor, payment_method, reference, idempotency_key, idempotency_payload_hash, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
    .bind(paymentId, input.tenantId, input.invoiceId, input.userId, input.amountMinor, input.method, input.reference, input.idempotencyKey, input.payloadHash, now.getTime());
  statements.push(paymentInsert);
  const transactionGuard = input.db.prepare("INSERT INTO invoice_payments (id, tenant_id, invoice_id, received_by, amount_minor, payment_method, reference, idempotency_key, idempotency_payload_hash, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() <> 1")
    .bind(`${paymentId}:guard`, input.tenantId, `__invoice_payment_guard__:${paymentId}`, input.userId, input.amountMinor, input.method, input.reference, `${input.idempotencyKey}:guard`, input.payloadHash, now.getTime());
  statements.push(transactionGuard);

  try {
    const results = await input.db.batch(statements);
    const invoiceChanges = (results[0]?.meta as D1Meta | undefined)?.changes;
    const scheduleChanges = results.slice(1, -2).every((result) => (result.meta as D1Meta | undefined)?.changes === 1);
    const paymentChanges = (results.at(-2)?.meta as D1Meta | undefined)?.changes;
    const guardChanges = (results.at(-1)?.meta as D1Meta | undefined)?.changes;
    if (invoiceChanges !== 1 || !scheduleChanges || paymentChanges !== 1 || guardChanges !== 0) throw new ApiError("تغير رصيد الفاتورة بالتزامن؛ حدّث الصفحة وأعد المحاولة", 409);
    return { paymentId, replayed: false };
  } catch (error) {
    const replay = assertMatchingReplay(await findExistingPayment(input.db, input.tenantId, input.idempotencyKey), input);
    if (replay) return replay;
    throw error;
  }
}

async function loadSchedules(input: InvoicePaymentInput): Promise<ScheduleRow[]> {
  const query = input.scheduleId
    ? "SELECT s.id, s.amount_minor AS amountMinor, s.paid_minor AS paidMinor FROM installment_schedules s JOIN installment_contracts c ON c.id = s.contract_id AND c.tenant_id = s.tenant_id AND c.invoice_id = s.invoice_id AND c.status = 'active' WHERE s.id = ? AND s.tenant_id = ? AND s.invoice_id = ? AND s.status = 'unpaid' LIMIT 1"
    : "SELECT s.id, s.amount_minor AS amountMinor, s.paid_minor AS paidMinor FROM installment_schedules s JOIN installment_contracts c ON c.id = s.contract_id AND c.tenant_id = s.tenant_id AND c.invoice_id = s.invoice_id AND c.status = 'active' WHERE s.tenant_id = ? AND s.invoice_id = ? AND s.status = 'unpaid' ORDER BY s.installment_number ASC";
  const bindings = input.scheduleId ? [input.scheduleId, input.tenantId, input.invoiceId] : [input.tenantId, input.invoiceId];
  const result = await input.db.prepare(query).bind(...bindings).all<ScheduleRow>();
  if (input.scheduleId && !result.results.length) throw new ApiError("القسط غير موجود أو تم سداده بالفعل", 409);
  return result.results;
}

async function loadInstallmentContract(input: InvoicePaymentInput): Promise<ContractRow | null> {
  return input.db.prepare("SELECT status FROM installment_contracts WHERE tenant_id = ? AND invoice_id = ? LIMIT 1")
    .bind(input.tenantId, input.invoiceId).first<ContractRow>();
}

export function allocateSchedulePayments(amountMinor: number, rows: ScheduleRow[]): ScheduleAllocation[] {
  if (!rows.length) return [];
  const availableMinor = rows.reduce((total, row) => total + row.amountMinor - row.paidMinor, 0);
  if (amountMinor > availableMinor) throw new ApiError("مبلغ الدفعة يتجاوز إجمالي الأقساط المتبقية", 409);
  let remaining = amountMinor;
  return rows.flatMap((row) => {
    if (remaining < 1) return [];
    const allocation = Math.min(remaining, row.amountMinor - row.paidMinor);
    remaining -= allocation;
    return [{ id: row.id, amountMinor: allocation }];
  });
}
