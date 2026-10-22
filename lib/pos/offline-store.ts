export type OfflineScope = { tenantId: string; userId: string };
export type OfflineInvoiceState = "pending_sync" | "synced" | "needs_attention";

export type OfflineInvoiceRecord<TPayload = unknown, TReceipt = unknown> = {
  id: string;
  tenantId: string;
  userId: string;
  branchId: string;
  localNumber: string;
  createdAt: string;
  state: OfflineInvoiceState;
  payload: TPayload;
  receipt: TReceipt;
  serverInvoiceNumber?: string;
  lastError?: string;
};

export type PosOfflineSnapshot<TContext = unknown, TCustomer = unknown, TProduct = unknown> = {
  key: string;
  tenantId: string;
  userId: string;
  branchId: string;
  savedAt: string;
  context: TContext;
  customers: TCustomer[];
  products: TProduct[];
};

const DATABASE_NAME = "qutoof-pos-offline-v1";
const DATABASE_VERSION = 1;
const SNAPSHOTS = "snapshots";
const INVOICES = "invoices";
const META = "meta";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("هذا المتصفح لا يدعم التخزين المحلي الآمن للكاشير"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(INVOICES)) {
        const store = db.createObjectStore(INVOICES, { keyPath: "id" });
        store.createIndex("scopeBranchCreated", ["tenantId", "userId", "branchId", "createdAt"], { unique: false });
        store.createIndex("scopeState", ["tenantId", "userId", "state"], { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح قاعدة بيانات الكاشير المحلية"));
    request.onblocked = () => reject(new Error("أغلق علامات تبويب الكاشير القديمة لإكمال تحديث التخزين المحلي"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر قراءة التخزين المحلي"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("تعذر حفظ بيانات الكاشير"));
    transaction.onabort = () => reject(transaction.error ?? new Error("أُلغيت معاملة التخزين المحلي"));
  });
}

export function snapshotKey(scope: OfflineScope, branchId: string): string {
  return `${scope.tenantId}:${scope.userId}:${branchId}`;
}

export async function savePosSnapshot<TContext, TCustomer, TProduct>(
  scope: OfflineScope,
  branchId: string,
  snapshot: Omit<PosOfflineSnapshot<TContext, TCustomer, TProduct>, "key" | "tenantId" | "userId" | "branchId" | "savedAt">,
): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(SNAPSHOTS, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(SNAPSHOTS).put({
    ...snapshot,
    key: snapshotKey(scope, branchId),
    tenantId: scope.tenantId,
    userId: scope.userId,
    branchId,
    savedAt: new Date().toISOString(),
  });
  await done;
  db.close();
}

export async function loadPosSnapshot<TContext, TCustomer, TProduct>(scope: OfflineScope, branchId: string): Promise<PosOfflineSnapshot<TContext, TCustomer, TProduct> | null> {
  const db = await openDatabase();
  const tx = db.transaction(SNAPSHOTS, "readonly");
  const done = transactionDone(tx);
  const result = await requestResult(tx.objectStore(SNAPSHOTS).get(snapshotKey(scope, branchId))) as PosOfflineSnapshot<TContext, TCustomer, TProduct> | undefined;
  await done;
  db.close();
  return result ?? null;
}

export async function nextLocalInvoiceIdentity(scope: OfflineScope, existingId?: string): Promise<{ id: string; localNumber: string }> {
  const db = await openDatabase();
  const tx = db.transaction(META, "readwrite");
  const store = tx.objectStore(META);
  const done = transactionDone(tx);
  const identity = await new Promise<{ deviceId: string; sequence: number }>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result as Array<{ key: string; value: string | number }>;
      const metadata = new Map(all.map((row) => [row.key, row.value]));
      const deviceId = typeof metadata.get("deviceId") === "string" ? metadata.get("deviceId") as string : crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
      const sequence = (typeof metadata.get("invoiceSequence") === "number" ? metadata.get("invoiceSequence") as number : 0) + 1;
      store.put({ key: "deviceId", value: deviceId });
      store.put({ key: "invoiceSequence", value: sequence });
      resolve({ deviceId, sequence });
    };
    request.onerror = () => reject(request.error ?? new Error("تعذر توليد رقم الفاتورة المحلية"));
  });
  await done;
  db.close();
  const localNumber = `OFF-${identity.deviceId}-${String(identity.sequence).padStart(7, "0")}`;
  return { id: existingId ?? crypto.randomUUID(), localNumber };
}

export async function saveOfflineInvoice<TPayload, TReceipt>(record: OfflineInvoiceRecord<TPayload, TReceipt>): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(INVOICES, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(INVOICES).put(record);
  await done;
  db.close();
}

export async function listOfflineInvoices<TPayload, TReceipt>(scope: OfflineScope, branchId: string): Promise<OfflineInvoiceRecord<TPayload, TReceipt>[]> {
  const db = await openDatabase();
  const tx = db.transaction(INVOICES, "readonly");
  const done = transactionDone(tx);
  const rows = await requestResult(tx.objectStore(INVOICES).index("scopeBranchCreated").getAll(IDBKeyRange.bound([scope.tenantId, scope.userId, branchId, ""], [scope.tenantId, scope.userId, branchId, "\uffff"]))) as OfflineInvoiceRecord<TPayload, TReceipt>[];
  await done;
  db.close();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPendingOfflineInvoices<TPayload, TReceipt>(scope: OfflineScope): Promise<OfflineInvoiceRecord<TPayload, TReceipt>[]> {
  const db = await openDatabase();
  const tx = db.transaction(INVOICES, "readonly");
  const done = transactionDone(tx);
  const rows = await requestResult(tx.objectStore(INVOICES).index("scopeState").getAll(IDBKeyRange.only([scope.tenantId, scope.userId, "pending_sync"]))) as OfflineInvoiceRecord<TPayload, TReceipt>[];
  await done;
  db.close();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateOfflineInvoice<TPayload, TReceipt>(
  id: string,
  update: Partial<Pick<OfflineInvoiceRecord<TPayload, TReceipt>, "state" | "serverInvoiceNumber" | "lastError" | "receipt">>,
): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(INVOICES, "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(INVOICES);
  await new Promise<void>((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result as OfflineInvoiceRecord<TPayload, TReceipt> | undefined;
      if (record) store.put({ ...record, ...update });
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error("تعذر قراءة الفاتورة المحلية"));
  });
  await done;
  db.close();
}

export function offlineSyncTag(scope: OfflineScope): string {
  return `qutoof-pos-sync-${scope.tenantId}-${scope.userId}`;
}
