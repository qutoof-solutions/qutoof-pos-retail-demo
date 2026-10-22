import { listPendingOfflineInvoices, offlineSyncTag, updateOfflineInvoice, type OfflineInvoiceRecord, type OfflineScope } from "@/lib/pos/offline-store";

type SyncResult = { synced: number; retryableError: string | null; needsAttention: number };
type ApiInvoiceResult = { invoice?: { invoiceNumber?: string } ; error?: string; retryable?: boolean };

export async function registerPosBackgroundSync(scope: OfflineScope): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncRegistration = registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };
    await syncRegistration.sync?.register(offlineSyncTag(scope));
  } catch {
    // Browser Background Sync is optional; the visible POS tab retries on the `online` event.
  }
}

export async function syncPendingPosInvoices<TPayload extends { idempotencyKey: string }, TReceipt extends { syncStatus?: "synced" | "pending_sync"; offlineLocalNumber?: string | null }>(
  scope: OfflineScope,
): Promise<SyncResult> {
  const pending = await listPendingOfflineInvoices<TPayload, TReceipt>(scope);
  const result: SyncResult = { synced: 0, retryableError: null, needsAttention: 0 };
  for (const record of pending) {
    try {
      const response = await fetch("/api/ops/invoices", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(record.payload),
      });
      const body = await response.json().catch(() => ({})) as ApiInvoiceResult;
      if (response.ok && body.invoice?.invoiceNumber) {
        await updateOfflineInvoice<TPayload, TReceipt>(record.id, {
          state: "synced",
          serverInvoiceNumber: body.invoice.invoiceNumber,
          lastError: undefined,
          receipt: { ...record.receipt, syncStatus: "synced", offlineLocalNumber: record.localNumber } as TReceipt,
        });
        result.synced += 1;
        continue;
      }
      const error = body.error ?? "تعذرت مزامنة الفاتورة المحلية";
      if (response.status >= 500 || response.status === 401 || response.status === 429 || body.retryable) {
        result.retryableError = error;
        break;
      }
      await updateOfflineInvoice<TPayload, TReceipt>(record.id, { state: "needs_attention", lastError: error });
      result.needsAttention += 1;
    } catch (cause) {
      result.retryableError = cause instanceof Error ? cause.message : "انقطع الاتصال أثناء مزامنة الفاتورة";
      break;
    }
  }
  if (result.retryableError) await registerPosBackgroundSync(scope);
  return result;
}

export function pendingInvoiceCount<TPayload, TReceipt>(records: OfflineInvoiceRecord<TPayload, TReceipt>[]): number {
  return records.filter((record) => record.state !== "synced").length;
}
