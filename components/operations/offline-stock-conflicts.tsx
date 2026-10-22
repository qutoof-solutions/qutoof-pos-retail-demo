"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, Notice } from "@/components/operations/shared";

type Conflict = {
  id: string;
  invoiceNumber: string;
  localInvoiceNumber: string | null;
  invoicePaidMinor: number;
  invoiceCurrency: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  requestedQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  quantityScale: number;
  createdAt: string;
};
type Action = "retry" | "edit" | "cancel" | "reallocate";
type Draft = { action: Action; quantity: string; warehouseId: string; refundReference: string; refundCompleted: boolean };
type Warehouse = { id: string; name: string };

export function OfflineStockConflicts({ branchId }: { branchId: string }) {
  const t = useTranslations("operationsRemaining");
  const locale = useLocale();
  const intlLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/ops/pos/offline-conflicts?branchId=${encodeURIComponent(branchId)}`, { cache: "no-store" });
      const body = await response.json() as { conflicts?: Conflict[]; warehouses?: Warehouse[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("failedToLoadStockAlerts"));
      setConflicts(body.conflicts ?? []);
      setWarehouses(body.warehouses ?? []);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("failedToLoadStockAlerts")); }
  }, [branchId, t]);
  useEffect(() => { void load(); }, [load]);
  function draftFor(conflict: Conflict): Draft {
    return drafts[conflict.id] ?? { action: "retry", quantity: String(conflict.shortageQuantity), warehouseId: "", refundReference: "", refundCompleted: false };
  }
  async function resolve(conflict: Conflict) {
    const draft = draftFor(conflict);
    if (draft.action === "cancel" && conflict.invoicePaidMinor > 0 && (!draft.refundCompleted || draft.refundReference.trim().length < 3)) {
      setError(t("refund.required"));
      return;
    }
    setBusyId(conflict.id);
    try {
      const quantity = draft.quantity.trim() ? Number(draft.quantity) : undefined;
      const response = await fetch("/api/ops/pos/offline-conflicts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: conflict.id,
        action: draft.action,
        idempotencyKey: `offline-conflict-ui-${crypto.randomUUID()}`,
        ...(draft.action !== "cancel" ? { replacementQuantity: quantity } : {}),
        ...(draft.action === "reallocate" ? { replacementWarehouseId: draft.warehouseId.trim() } : {}),
        ...(draft.action === "cancel" && conflict.invoicePaidMinor > 0 ? { refundReference: draft.refundReference.trim(), refundCompleted: draft.refundCompleted } : {}),
      }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        const message = body.error === "offline_conflict_refund_required" ? t("refund.required") : body.error === "offline_conflict_refund_reconciliation_failed" ? t("refund.reconciliationFailed") : body.error ?? t("failedToAcknowledgeAlert");
        throw new Error(message);
      }
      setConflicts((rows) => rows.filter((row) => row.id !== conflict.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("failedToAcknowledgeAlert")); }
    finally { setBusyId(""); }
  }
  if (!conflicts.length && !error) return null;
  return <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-live="polite">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-bold text-amber-950"><AlertTriangle size={18} />{conflicts.length ? t("unreviewedStockShortagesCount", { count: conflicts.length }) : t("failedToRefreshStockAlerts")}</div>
      <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={14} /> {t("refresh")}</Button>
    </div>
    {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    {conflicts.length > 0 && <div className="mt-3 space-y-2">{conflicts.map((conflict) => {
      const divisor = 10 ** conflict.quantityScale;
      const formatQty = (quantity: number) => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: conflict.quantityScale }).format(quantity / divisor);
      const draft = draftFor(conflict);
      return <article key={conflict.id} className="rounded-xl border border-amber-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-start gap-3"><div className="min-w-52 flex-1"><strong className="text-amber-950">{conflict.itemName} · {conflict.sku}</strong><p className="mt-1 text-xs text-slate-600">{t("invoiceLabel")} {conflict.localInvoiceNumber ?? conflict.invoiceNumber} · {conflict.warehouseName} · {formatDate(conflict.createdAt, true, locale)}</p><p className="mt-1 text-xs text-amber-900">{t("requestLabel")} {formatQty(conflict.requestedQuantity)} · {t("availableLabel")} {formatQty(conflict.availableQuantity)} · {t("shortageLabel")} {formatQty(conflict.shortageQuantity)}</p></div>
        <div className="flex flex-wrap items-end gap-2"><select className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={draft.action} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, action: event.target.value as Action } }))} aria-label={t("confirm")}><option value="retry">{t("button.retry")}</option><option value="edit">{t("button.edit")}</option><option value="reallocate">{t("button.save")}</option><option value="cancel">{t("button.cancel")}</option></select>{draft.action !== "cancel" && <input className="h-9 w-28 rounded-md border border-slate-300 px-2 text-sm" type="number" min="1" step="1" value={draft.quantity} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, quantity: event.target.value } }))} aria-label={t("shortageLabel")} />}{draft.action === "reallocate" && <input className="h-9 w-52 rounded-md border border-slate-300 px-2 text-sm" value={draft.warehouseId} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, warehouseId: event.target.value } }))} aria-label={t("availableLabel")} />}
        {draft.action === "reallocate" && <select className="h-9 w-52 rounded-md border border-slate-300 bg-white px-2 text-sm" value={draft.warehouseId} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, warehouseId: event.target.value } }))} aria-label={t("select.reallocationWarehouse")}><option value="">{t("select.reallocationWarehouse")}</option>{warehouses.filter((warehouse) => warehouse.id !== conflict.warehouseId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>}
        {draft.action === "cancel" && conflict.invoicePaidMinor > 0 && <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="mb-2 font-semibold">{t("refund.amount", { amount: new Intl.NumberFormat(intlLocale, { style: "currency", currency: conflict.invoiceCurrency }).format(conflict.invoicePaidMinor / 100) })}</p><input className="mb-2 h-9 w-full rounded-md border border-slate-300 px-2 text-sm" value={draft.refundReference} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, refundReference: event.target.value } }))} aria-label={t("refund.reference")} placeholder={t("refund.reference")} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.refundCompleted} disabled={busyId === conflict.id} onChange={(event) => setDrafts((current) => ({ ...current, [conflict.id]: { ...draft, refundCompleted: event.target.checked } }))} />{t("refund.completed")}</label></div>}
        <Button type="button" size="sm" disabled={busyId === conflict.id} onClick={() => void resolve(conflict)}>{busyId === conflict.id ? <RefreshCw size={14} className="animate-spin" /> : draft.action === "cancel" ? <Check size={14} /> : <Save size={14} />} {t("button.save")}</Button></div></div>
      </article>;
    })}</div>}
  </section>;
}
