"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, CircleCheck, CircleX, Clock3, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, EmptyState, formatMoney, InputField, Loading, ModuleTitle, Notice, SelectField, useAction } from "@/components/operations/shared";
import { useLocale, useTranslations } from "next-intl";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type Customer = { id: string; fullName: string; phone: string; branchId: string | null };
type Invoice = { id: string; invoiceNumber: string; branchId: string; customerId: string; customerName: string | null; totalMinor: number; paidMinor: number; status: string };
type Purchase = { id: string; invoiceNumber: string; supplierId: string; supplierName: string; payableMinor: number; totalMinor: number; paidMinor: number };
type CustomerCheque = { id: string; branchId: string; customerId: string; customerName: string; invoiceId: string | null; invoiceNumber: string | null; chequeNumber: string; bankName: string; dueDate: string; amountMinor: number; status: string; statusReason?: string | null; notes: string | null };
type SupplierCheque = { id: string; supplierId: string; supplierName: string; purchaseInvoiceId: string; invoiceNumber: string; chequeNumber: string; bankName: string; dueDate: string; amountMinor: number; status: string; notes: string | null };
type ReceivedForm = { branchId: string; customerId: string; invoiceId: string; chequeNumber: string; bankName: string; dueDate: string; amount: string; notes: string };
type IssuedForm = { purchaseInvoiceId: string; chequeNumber: string; bankName: string; dueDate: string; amount: string; notes: string };
type StatusAction = "collected" | "cashed" | "returned" | "rejected";

const statusClass: Record<string, string> = { pending: "bg-amber-50 text-amber-800", collected: "bg-emerald-50 text-emerald-800", cashed: "bg-emerald-50 text-emerald-800", returned: "bg-rose-50 text-rose-800", rejected: "bg-slate-100 text-slate-700" };

export function ChequesModule({ canReceive, canIssue }: { canReceive: boolean; canIssue: boolean }) {
  const t = useTranslations("operationsRemaining.cheques");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<"received" | "issued">(canReceive ? "received" : "issued");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [customerCheques, setCustomerCheques] = useState<CustomerCheque[]>([]);
  const [supplierCheques, setSupplierCheques] = useState<SupplierCheque[]>([]);
  const [showReceivedForm, setShowReceivedForm] = useState(false);
  const [showIssuedForm, setShowIssuedForm] = useState(false);
  const [receivedForm, setReceivedForm] = useState<ReceivedForm>({ branchId: "", customerId: "", invoiceId: "", chequeNumber: "", bankName: "", dueDate: "", amount: "", notes: "" });
  const [issuedForm, setIssuedForm] = useState<IssuedForm>({ purchaseInvoiceId: "", chequeNumber: "", bankName: "", dueDate: "", amount: "", notes: "" });
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [received, issued] = await Promise.all([
          canReceive ? Promise.all([
            apiRequest<{ branches: Branch[] }>("/api/ops/context"),
            apiRequest<{ customers: Customer[] }>("/api/ops/customers?limit=100"),
            apiRequest<{ invoices: Invoice[] }>("/api/ops/invoices"),
            apiRequest<{ cheques: CustomerCheque[] }>("/api/ops/customer-cheques"),
          ]) : Promise.resolve(null),
          canIssue ? Promise.all([
            apiRequest<{ purchases: Purchase[] }>("/api/ops/purchases"),
            apiRequest<{ cheques: SupplierCheque[] }>("/api/ops/supplier-cheques"),
          ]) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (received) {
          setBranches(received[0].branches);
          setCustomers(received[1].customers);
          setInvoices(received[2].invoices);
          setCustomerCheques(received[3].cheques);
          setReceivedForm((current) => ({ ...current, branchId: current.branchId || received[0].branches[0]?.id || "" }));
        }
        if (issued) {
          setPurchases(issued[0].purchases);
          setSupplierCheques(issued[1].cheques);
        }
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : t("error.loadCheques"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [canIssue, canReceive, refreshKey, t]);

  const eligibleInvoices = useMemo(() => invoices.filter((invoice) => invoice.branchId === receivedForm.branchId && invoice.customerId === receivedForm.customerId && ["issued", "partially_paid"].includes(invoice.status)), [invoices, receivedForm.branchId, receivedForm.customerId]);
  const eligiblePurchases = useMemo(() => purchases.filter((purchase) => purchase.payableMinor - supplierCheques.filter((cheque) => cheque.purchaseInvoiceId === purchase.id && cheque.status === "pending").reduce((sum, cheque) => sum + cheque.amountMinor, 0) > 0), [purchases, supplierCheques]);

  async function receiveCheque(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/customer-cheques", { method: "POST", body: JSON.stringify({ ...receivedForm, invoiceId: receivedForm.invoiceId || null, amount: Number(receivedForm.amount), notes: receivedForm.notes || null }) }), t("success.receivedRegistered"));
    if (result) {
      setReceivedForm((current) => ({ ...current, customerId: "", invoiceId: "", chequeNumber: "", bankName: "", dueDate: "", amount: "", notes: "" }));
      setShowReceivedForm(false);
      setRefreshKey((value) => value + 1);
    }
  }

  async function issueCheque(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/supplier-cheques", { method: "POST", body: JSON.stringify({ ...issuedForm, amount: Number(issuedForm.amount), notes: issuedForm.notes || null }) }), t("success.issuedRegistered"));
    if (result) {
      setIssuedForm({ purchaseInvoiceId: "", chequeNumber: "", bankName: "", dueDate: "", amount: "", notes: "" });
      setShowIssuedForm(false);
      setRefreshKey((value) => value + 1);
    }
  }

  async function changeStatus(direction: "received" | "issued", id: string, status: StatusAction) {
    const endpoint = direction === "received" ? "/api/ops/customer-cheques" : "/api/ops/supplier-cheques";
    const wasCollected = direction === "received" && customerCheques.some((cheque) => cheque.id === id && cheque.status === "collected");
    const success = status === "collected"
      ? t("messages.collected")
      : status === "cashed"
        ? t("messages.cashed")
        : status === "returned"
          ? (wasCollected ? t("messages.returned.wasCollected") : t("messages.returned.recorded"))
          : (wasCollected ? t("messages.rejected.wasCollected") : t("messages.rejected.recorded"));
    const result = await action.execute(() => apiRequest(endpoint, { method: "PATCH", body: JSON.stringify({ id, status }) }), success);
    if (result) setRefreshKey((value) => value + 1);
  }

  const tabs = [
    ...(canReceive ? [{ id: "received" as const, label: t("tabs.receivedLabel"), icon: Banknote }] : []),
    ...(canIssue ? [{ id: "issued" as const, label: t("tabs.issuedLabel"), icon: FileCheck2 }] : []),
  ];

  return <div>
    <ModuleTitle eyebrow={t("module.eyebrow")} title={t("module.title")} description={t("module.description")} action={<div className="flex items-center gap-2 rounded-xl bg-teal/5 px-3 py-2 text-sm font-medium text-teal"><Banknote size={18} /> {t("module.action")}</div>} />
    {tabs.length > 1 && <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label={t("tabs.ariaLabel")}>{tabs.map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant={activeTab === id ? "default" : "outline"} role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon size={16} />{label}</Button>)}</div>}
    {action.error && <div className="mb-4"><Notice>{action.error}</Notice></div>}{action.success && <div className="mb-4"><Notice kind="success">{action.success}</Notice></div>}{loadError && <div className="mb-4"><Notice>{loadError}</Notice></div>}
    {loading ? <Loading /> : activeTab === "received" && canReceive ? <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-navy">{t("received.heading")}</h2><p className="mt-1 text-sm text-slate-600">{t("received.description")}</p></div><Button type="button" onClick={() => setShowReceivedForm((value) => !value)}>{showReceivedForm ? t("received.form.close") : t("received.form.open")}</Button></div>
      {showReceivedForm && <form onSubmit={receiveCheque} className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3">
        <SelectField label={t("form.branch")} value={receivedForm.branchId} onChange={(branchId) => setReceivedForm((current) => ({ ...current, branchId, invoiceId: "" }))} options={branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} required />
        <SelectField label={t("form.customer")} value={receivedForm.customerId} onChange={(customerId) => setReceivedForm((current) => ({ ...current, customerId, invoiceId: "" }))} options={customers.map((customer) => ({ value: customer.id, label: `${customer.fullName} · ${customer.phone}` }))} required />
        <SelectField label={t("form.invoiceOptional")} value={receivedForm.invoiceId} onChange={(invoiceId) => setReceivedForm((current) => ({ ...current, invoiceId }))} options={[{ value: "", label: t("form.unassignedCheque") }, ...eligibleInvoices.map((invoice) => ({ value: invoice.id, label: `${invoice.invoiceNumber} · ${t("form.remaining")} ${formatMoney(invoice.totalMinor - invoice.paidMinor, locale)}` }))]} />
        <InputField label={t("form.chequeNumber")} value={receivedForm.chequeNumber} onChange={(chequeNumber) => setReceivedForm((current) => ({ ...current, chequeNumber }))} required />
        <InputField label={t("form.bankName")} value={receivedForm.bankName} onChange={(bankName) => setReceivedForm((current) => ({ ...current, bankName }))} required />
        <InputField label={t("form.dueDate")} value={receivedForm.dueDate} onChange={(dueDate) => setReceivedForm((current) => ({ ...current, dueDate }))} type="date" required />
        <InputField label={t("form.amount")} value={receivedForm.amount} onChange={(amount) => setReceivedForm((current) => ({ ...current, amount }))} type="number" min="0.01" step="0.01" required />
        <InputField label={t("form.notes")} value={receivedForm.notes} onChange={(notes) => setReceivedForm((current) => ({ ...current, notes }))} />
        <div className="flex items-end gap-2"><Button type="submit" disabled={action.busy || !customers.length || !branches.length}>{action.busy ? t("form.saving") : t("form.saveCheque")}</Button><Button type="button" variant="outline" onClick={() => setShowReceivedForm(false)}>{t("form.cancel")}</Button></div>
        <p className="text-xs leading-5 text-slate-500 md:col-span-3">{t("received.form.note")}</p>
      </form>}
      {customerCheques.length === 0 ? <EmptyState title={t("received.empty.title")} detail={t("received.empty.detail")} /> : <ChequeTable direction="received" rows={customerCheques} busy={action.busy} onStatus={changeStatus} locale={locale} />}
    </section> : activeTab === "issued" && canIssue ? <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-navy">{t("issued.heading")}</h2><p className="mt-1 text-sm text-slate-600">{t("issued.description")}</p></div><Button type="button" onClick={() => setShowIssuedForm((value) => !value)}>{showIssuedForm ? t("issued.form.close") : t("issued.form.open")}</Button></div>
      {showIssuedForm && <form onSubmit={issueCheque} className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3">
        <SelectField label={t("form.purchaseInvoice")} value={issuedForm.purchaseInvoiceId} onChange={(purchaseInvoiceId) => setIssuedForm((current) => ({ ...current, purchaseInvoiceId }))} options={eligiblePurchases.map((purchase) => ({ value: purchase.id, label: `${purchase.supplierName} · ${purchase.invoiceNumber} · ${t("form.remaining")} ${formatMoney(purchase.payableMinor - supplierCheques.filter((cheque) => cheque.purchaseInvoiceId === purchase.id && cheque.status === "pending").reduce((sum, cheque) => sum + cheque.amountMinor, 0), locale)}` }))} required />
        <InputField label={t("form.chequeNumber")} value={issuedForm.chequeNumber} onChange={(chequeNumber) => setIssuedForm((current) => ({ ...current, chequeNumber }))} required />
        <InputField label={t("form.bankName")} value={issuedForm.bankName} onChange={(bankName) => setIssuedForm((current) => ({ ...current, bankName }))} required />
        <InputField label={t("form.dueDate")} value={issuedForm.dueDate} onChange={(dueDate) => setIssuedForm((current) => ({ ...current, dueDate }))} type="date" required />
        <InputField label={t("form.amount")} value={issuedForm.amount} onChange={(amount) => setIssuedForm((current) => ({ ...current, amount }))} type="number" min="0.01" step="0.01" required />
        <InputField label={t("form.notes")} value={issuedForm.notes} onChange={(notes) => setIssuedForm((current) => ({ ...current, notes }))} />
        <div className="flex items-end gap-2"><Button type="submit" disabled={action.busy || !eligiblePurchases.length}>{action.busy ? t("form.saving") : t("form.saveIssuedCheque")}</Button><Button type="button" variant="outline" onClick={() => setShowIssuedForm(false)}>{t("form.cancel")}</Button></div>
      </form>}
      {supplierCheques.length === 0 ? <EmptyState title={t("issued.empty.title")} detail={t("issued.empty.detail")} /> : <ChequeTable direction="issued" rows={supplierCheques} busy={action.busy} onStatus={changeStatus} locale={locale} />}
      {eligiblePurchases.length === 0 && <div className="mt-4"><Notice kind="info">{t("issued.noEligiblePurchases")}</Notice></div>}
    </section> : <EmptyState title={t("noPermission.title")} detail={t("noPermission.detail")} />}
  </div>;
}

function ChequeTable({ direction, rows, busy, onStatus, locale }: { direction: "received" | "issued"; rows: Array<CustomerCheque | SupplierCheque>; busy: boolean; onStatus: (direction: "received" | "issued", id: string, status: StatusAction) => Promise<void>; locale: string }) {
  const t = useTranslations("operationsRemaining.cheques");
  const intlLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-[850px] w-full text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">{t("table.header.chequeBank")}</th><th className="p-3">{t("table.header.party")}</th><th className="p-3">{t("table.header.invoice")}</th><th className="p-3">{t("table.header.dueDate")}</th><th className="p-3">{t("table.header.amount")}</th><th className="p-3">{t("table.header.status")}</th><th className="p-3">{t("table.header.action")}</th></tr></thead><tbody>{rows.map((row) => {
    const check = row as CustomerCheque & SupplierCheque;
    return <tr key={row.id} className="border-t border-slate-100"><td className="p-3"><strong>{row.chequeNumber}</strong><p className="text-xs text-slate-500">{row.bankName}</p></td><td className="p-3">{direction === "received" ? (row as CustomerCheque).customerName : (row as SupplierCheque).supplierName}</td><td className="p-3">{direction === "received" ? ((row as CustomerCheque).invoiceNumber ?? t("table.unassigned")) : (row as SupplierCheque).invoiceNumber}</td><td className="p-3">{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${row.dueDate}T12:00:00Z`))}</td><td className="p-3 font-semibold">{formatMoney(row.amountMinor, locale)}</td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[row.status] ?? "bg-slate-100 text-slate-700"}`}>{row.status === "pending" ? <Clock3 size={13} /> : row.status === "rejected" || row.status === "returned" ? <CircleX size={13} /> : <CircleCheck size={13} />}{t(`status.${row.status}`) ?? row.status}</span>{direction === "received" && (row as CustomerCheque).statusReason && <p className="mt-1 max-w-52 text-xs text-rose-700">{(row as CustomerCheque).statusReason}</p>}</td><td className="p-3">{row.status === "pending" ? <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" disabled={busy} onClick={() => void onStatus(direction, check.id, direction === "received" ? "collected" : "cashed")}>{direction === "received" ? t("table.action.confirmCollect") : t("table.action.confirmCash")}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onStatus(direction, check.id, "returned")}>{t("table.action.returned")}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onStatus(direction, check.id, "rejected")}>{t("table.action.rejected")}</Button></div> : direction === "received" && row.status === "collected" ? <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onStatus(direction, check.id, "returned")}>{t("table.action.recordReturnReversePayment")}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onStatus(direction, check.id, "rejected")}>{t("table.action.bankRejected")}</Button></div> : <span className="text-xs text-slate-400">{t("table.action.noAction")}</span>}</td></tr>;
  })}</tbody></table></div>;
}
