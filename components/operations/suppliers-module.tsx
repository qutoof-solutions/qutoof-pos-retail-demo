"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest, EmptyState, formatMoney, InputField, Loading, ModuleTitle, Notice, SelectField, useAction, useLoad } from "@/components/operations/shared";

type Supplier = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; taxNumber: string | null; isActive: number; payableMinor: number };
type Purchase = { id: string; invoiceNumber: string; totalMinor: number; paidMinor: number; payableMinor: number; status: string; supplierId: string; supplierName: string; createdAt: number };
type SuppliersData = { suppliers: Supplier[] };
type PurchasesData = { purchases: Purchase[] };
const blank = { name: "", contactName: "", phone: "", email: "", address: "", taxNumber: "", notes: "" };

export function SuppliersModule() {
  const t = useTranslations("purchases-suppliers");
  const locale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const suppliers = useLoad<SuppliersData>("/api/ops/suppliers", refreshKey);
  const purchases = useLoad<PurchasesData>("/api/ops/purchases", refreshKey);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blank);
  const [payingId, setPayingId] = useState("");
  const [payment, setPayment] = useState({ amount: "", paymentMethod: "cash", reference: "" });
  const action = useAction();
  async function createSupplier(event: React.FormEvent) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/suppliers", { method: "POST", body: JSON.stringify({ ...form, contactName: form.contactName || null, phone: form.phone || null, email: form.email || null, address: form.address || null, taxNumber: form.taxNumber || null, notes: form.notes || null }) }), t("suppliers.messages.created"));
    if (result) { setForm(blank); setShowCreate(false); setRefreshKey((n) => n + 1); }
  }
  async function pay(event: React.FormEvent, supplierId: string, invoice: Purchase) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest(`/api/ops/suppliers/${supplierId}/payments`, { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), purchaseInvoiceId: invoice.id, amount: Number(payment.amount), paymentMethod: payment.paymentMethod, reference: payment.reference || null }) }), t("suppliers.messages.paymentRecorded"));
    if (result) { setPayingId(""); setPayment({ amount: "", paymentMethod: "cash", reference: "" }); setRefreshKey((n) => n + 1); }
  }
  const pendingPurchases = purchases.data?.purchases.filter((p) => p.payableMinor > 0) ?? [];
  return <div>
    <ModuleTitle eyebrow={t("suppliers.heading.eyebrow")} title={t("suppliers.heading.title")} description={t("suppliers.heading.description")} action={<Button onClick={() => setShowCreate((v) => !v)}>{t("suppliers.actions.addSupplier")}</Button>} />
    <div className="mb-5 rounded-2xl border border-teal/20 bg-teal/5 p-4 text-sm leading-7 text-slate-700">{t("suppliers.info")}</div>
    {action.error && <Notice>{action.error}</Notice>}{action.success && <div className="mb-4"><Notice kind="success">{action.success}</Notice></div>}
    {showCreate && <form onSubmit={createSupplier} className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3"><InputField label={t("suppliers.fields.name")} value={form.name} onChange={(value) => setForm({ ...form, name: value })} required /><InputField label={t("suppliers.fields.contactName")} value={form.contactName} onChange={(value) => setForm({ ...form, contactName: value })} /><InputField label={t("suppliers.fields.phone")} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><InputField label={t("suppliers.fields.email")} value={form.email} onChange={(value) => setForm({ ...form, email: value })} type="email" /><InputField label={t("suppliers.fields.taxNumber")} value={form.taxNumber} onChange={(value) => setForm({ ...form, taxNumber: value })} /><InputField label={t("suppliers.fields.address")} value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><InputField label={t("suppliers.fields.notes")} value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} /><div className="flex gap-2 md:col-span-3"><Button disabled={action.busy} type="submit">{t("suppliers.actions.saveSupplier")}</Button><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>{t("suppliers.actions.cancel")}</Button></div></form>}
    {suppliers.error && <Notice>{suppliers.error}</Notice>}{suppliers.loading ? <Loading /> : !suppliers.data?.suppliers.length ? <EmptyState title={t("suppliers.empty.noSuppliers")} detail={t("suppliers.empty.noSuppliersDetail")} /> : <div className="grid gap-3 md:grid-cols-2">{suppliers.data.suppliers.map((supplier) => <article key={supplier.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-navy">{supplier.name}</h2><p className="mt-1 text-sm text-slate-500">{supplier.contactName || ""}{supplier.phone ? ` · ${supplier.phone}` : ""}</p><p className="text-xs text-slate-500">{supplier.email || ""}</p></div><strong className={supplier.payableMinor ? "text-amber-800" : "text-emerald-700"}>{formatMoney(supplier.payableMinor, locale)}</strong></div><p className="mt-3 text-xs text-slate-500">{t("suppliers.labels.payableToSupplier")}</p><Button size="sm" variant="outline" className="mt-3" onClick={async () => { await action.execute(() => apiRequest(`/api/ops/suppliers/${supplier.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !supplier.isActive }) }), supplier.isActive ? t("suppliers.messages.deactivated") : t("suppliers.messages.activated")); setRefreshKey((n) => n + 1); }}>{supplier.isActive ? t("suppliers.actions.deactivate") : t("suppliers.actions.activate")}</Button></article>)}</div>}
    <section className="mt-8"><h2 className="mb-3 text-lg font-bold text-navy">{t("suppliers.sections.unpaidInvoices")}</h2>{purchases.error && <Notice>{purchases.error}</Notice>}{purchases.loading ? <Loading /> : pendingPurchases.length === 0 ? <EmptyState title={t("suppliers.empty.noPayables")} detail={t("suppliers.empty.noPayablesDetail")} /> : <div className="space-y-3">{pendingPurchases.map((invoice) => <article key={invoice.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{invoice.supplierName} · {t("suppliers.labels.invoice")} {invoice.invoiceNumber}</strong><span>{t("suppliers.labels.total")} {formatMoney(invoice.totalMinor, locale)} · {t("suppliers.labels.paid")} {formatMoney(invoice.paidMinor, locale)} · {t("suppliers.labels.remaining")} <b className="text-amber-800">{formatMoney(invoice.payableMinor, locale)}</b></span></div>{payingId === invoice.id ? <form onSubmit={(event) => pay(event, invoice.supplierId, invoice)} className="mt-4 grid gap-3 sm:grid-cols-4"><InputField label={t("suppliers.fields.paymentAmount")} value={payment.amount} onChange={(value) => setPayment({ ...payment, amount: value })} type="number" min="0.01" max={invoice.payableMinor / 100} step="0.01" required /><SelectField label={t("suppliers.fields.paymentMethod")} value={payment.paymentMethod} onChange={(value) => setPayment({ ...payment, paymentMethod: value })} options={[{ value: "cash", label: t("purchases.paymentMethods.cash") }, { value: "bank", label: t("purchases.paymentMethods.bank") }, { value: "wallet", label: t("purchases.paymentMethods.wallet") }, { value: "instapay", label: t("purchases.paymentMethods.instapay") }]} required /><InputField label={t("suppliers.fields.paymentReference")} value={payment.reference} onChange={(value) => setPayment({ ...payment, reference: value })} /><div className="flex items-end gap-2"><Button disabled={action.busy} type="submit">{t("suppliers.actions.recordPayment")}</Button><Button type="button" variant="outline" onClick={() => setPayingId("")}>{t("suppliers.actions.cancel")}</Button></div></form> : <Button size="sm" variant="outline" className="mt-3" onClick={() => { setPayingId(invoice.id); setPayment({ amount: (invoice.payableMinor / 100).toFixed(2), paymentMethod: "cash", reference: "" }); }}>{t("suppliers.actions.recordPayment")}</Button>}</article>)}</div>}</section>
  </div>;
}
