"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, Clock3, CreditCard, FileImage, LoaderCircle, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate, formatMoney } from "@/components/platform/api-client";
import { catalogName } from "@/lib/i18n/localized-catalog";

type Plan = { id: string; code: string | null; nameAr: string; nameEn: string; billingCycle: string; customDays: number | null; priceMinor: number; currency: string; features: Record<string, boolean> };
type Addon = { id: string; code: string | null; nameAr: string; nameEn: string; billingCycle: string; customDays: number | null; priceMinor: number; currency: string; resourceType: "warehouse" | "branch" | "user" | "doctor" };
type RequestBase = { id: string; amountMinor: number; currency: string; paymentMethod: string; status: string; rejectionReason: string | null; createdAt: string; reviewedAt: string | null };
type BillingData = {
  billingEnabled: boolean;
  canPurchaseAddons: boolean;
  tenant: { id: string; name: string; status: string; trialStartedAt: string | null; trialEndsAt: string | null; subscriptionEndsAt: string | null; platformPlanId: string | null };
  settings: { trialDays: number; graceDays: number; vodafoneCashNumber: string; instapayQrUrl: string; currency: string };
  plans: Plan[];
  addOns: Addon[];
  usage: Record<string, { limit: number | null; used: number; available: number | null }>;
  resourceAddons: { id: string; resourceType: string; quantity: number; startsAt: string; endsAt: string; active: boolean }[];
  requests: (RequestBase & { planNameSnapshot: string; billingCycleSnapshot: string })[];
  addonRequests: (RequestBase & { addonNameSnapshot: string; resourceType: string; quantity: number; invoiceNumber: string | null; subscriptionEndSnapshot: string })[];
  invoices: { id: string; invoiceNumber: string; planNameSnapshot: string; amountMinor: number; currency: string; paymentMethod: string; periodStart: string; periodEnd: string; status: string; paidAt: string }[];
};


export function BillingPanel({ canManage, initialStatus }: { canManage: boolean; initialStatus: string }) {
  const locale = useLocale();
  const t = useTranslations("remaining-platform-print");
  const [data, setData] = useState<BillingData | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [selectedAddon, setSelectedAddon] = useState("");
  const [addonQuantity, setAddonQuantity] = useState(1);
  const [addonQuote, setAddonQuote] = useState<{ amountMinor: number; currency: string; subscriptionEndsAt: string } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("vodafone_cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!canManage) return;
    setError("");
    try {
      const response = await apiRequest<BillingData>("/api/ops/billing");
      setData(response);
      setSelectedPlan((current) => current || response.plans[0]?.id || "");
      const requestedAddon = new URLSearchParams(window.location.search).get("addon");
      setSelectedAddon((current) => current || (requestedAddon && response.addOns.some((addon) => addon.id === requestedAddon) ? requestedAddon : response.addOns[0]?.id || ""));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billing.loadError")); }
  }, [canManage, t]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => data?.plans.find((plan) => plan.id === selectedPlan), [data, selectedPlan]);
  const selectedAddonPlan = useMemo(() => data?.addOns.find((addon) => addon.id === selectedAddon), [data, selectedAddon]);
  const hasPending = (data?.requests.some((item) => item.status === "pending_review") ?? false) || (data?.addonRequests.some((item) => item.status === "pending_review") ?? false);
  const isLocked = ["pending_trial", "expired", "frozen", "cancelled"].includes(data?.tenant.status ?? initialStatus);

  useEffect(() => {
    if (!selectedAddonPlan || !data?.canPurchaseAddons) {
      setAddonQuote(null);
      setQuoteError("");
      return;
    }
    let active = true;
    setAddonQuote(null);
    setQuoteError("");
    const query = new URLSearchParams({ addonPlanId: selectedAddonPlan.id, quantity: String(addonQuantity) });
    void apiRequest<{ amountMinor: number; currency: string; subscriptionEndsAt: string }>(`/api/ops/billing/addon-requests?${query}`).then((quote) => {
      if (active) setAddonQuote(quote);
    }).catch((cause) => {
      if (active) setQuoteError(cause instanceof Error ? cause.message : t("billing.quoteError"));
    });
    return () => { active = false; };
  }, [selectedAddonPlan, addonQuantity, data?.canPurchaseAddons, t]);

  async function startTrial() {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/api/ops/billing/trial", { method: "POST" });
      setNotice(t("billing.trialStarted"));
      await load();
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billing.trialError")); }
    finally { setBusy(false); }
  }

  async function submitReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!selectedPlan) { setError(t("billing.planRequired")); return; }
    form.set("planId", selectedPlan);
    form.set("paymentMethod", paymentMethod);
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ requestId: string; telegramNotification: string }>("/api/ops/billing/requests", { method: "POST", body: form });
      setNotice(result.telegramNotification === "sent" ? t("billing.receiptSent") : t("billing.receiptQueued"));
      formElement.reset();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billing.receiptError")); }
    finally { setBusy(false); }
  }

  async function submitAddonReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!selectedAddonPlan) { setError(t("billing.addonRequired")); return; }
    form.set("addonPlanId", selectedAddonPlan.id);
    form.set("quantity", String(addonQuantity));
    form.set("paymentMethod", paymentMethod);
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ telegramNotification: string }>("/api/ops/billing/addon-requests", { method: "POST", body: form });
      setNotice(result.telegramNotification === "sent" ? t("billing.addonSent") : t("billing.addonQueued"));
      formElement.reset();
      setAddonQuantity(1);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billing.addonError")); }
    finally { setBusy(false); }
  }

  return <section className="mx-auto w-full min-w-0 max-w-5xl space-y-6 overflow-x-hidden" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("billing.eyebrow")}</p><h1 className="mt-2 text-2xl font-bold text-navy">{t("billing.title")}</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">{t("billing.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />{t("common.refresh")}</Button></div>
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-4"><span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-navy shadow-sm">{statusLabel(data?.tenant.status ?? initialStatus).startsWith("billing.") ? t(statusLabel(data?.tenant.status ?? initialStatus) as never) : statusLabel(data?.tenant.status ?? initialStatus)}</span>{data?.tenant.trialEndsAt && data.tenant.status === "active_trial" && <span className="text-sm text-slate-600">{t("billing.trialEnds")}: {formatDate(data.tenant.trialEndsAt, locale)}</span>}{data?.tenant.subscriptionEndsAt && ["active", "grace"].includes(data.tenant.status) && <span className="text-sm text-slate-600">{t("billing.paidEnds")}: {formatDate(data.tenant.subscriptionEndsAt, locale)}</span>}</div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-4 rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
      {!canManage ? <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900"><LockKeyhole className="mb-2" size={20} /><p>{t("billing.managerOnly")}</p></div> : <>
        {data?.tenant.status === "pending_trial" && <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-teal/20 bg-teal/5 p-5"><div><h2 className="font-bold text-navy">{t("billing.startTrialTitle")}</h2><p className="mt-1 text-sm text-slate-600">{t("billing.trialDuration")}: {data.settings.trialDays} {t("billing.days")}</p></div><Button onClick={() => void startTrial()} disabled={busy || !data.billingEnabled}>{busy && <LoaderCircle className="animate-spin" size={16} />}{t("billing.activateTrial")}</Button></div>}
        {!data && !error && <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />{t("billing.loading")}</div>}
        {data?.billingEnabled === false && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t("billing.disabled")}</p>}
        {isLocked && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900"><ShieldAlert className="mb-1" size={20} /><p>{data?.tenant.status === "frozen" ? t("billing.frozen") : t("billing.locked")}</p></div>}
        <div className="mt-7 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
          <div className="rounded-2xl border border-slate-200 p-5"><h2 className="flex items-center gap-2 font-bold text-navy"><CreditCard size={19} className="text-teal" />{t("billing.choosePlan")}</h2>
            {data?.plans.length ? <>
              <label className="mt-4 block text-sm font-medium text-slate-700">{t("billing.plan")}<select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">{t("billing.choosePlanOption")}</option>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{catalogName(plan, locale === "ar" ? "ar" : "en")} · {formatMoney(plan.priceMinor, plan.currency, locale)} · {cycleLabel(plan.billingCycle)}</option>)}</select></label>
              {selected && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><strong className="text-navy">{catalogName(selected, locale === "ar" ? "ar" : "en")}</strong><span className="mx-2">·</span>{formatMoney(selected.priceMinor, selected.currency, locale)} / {cycleLabel(selected.billingCycle)}{Object.entries(selected.features).filter(([, enabled]) => enabled).length > 0 && <ul className="mt-2 list-inside list-disc">{Object.entries(selected.features).filter(([, enabled]) => enabled).map(([key]) => <li key={key}>{key}</li>)}</ul>}</div>}
              <PaymentMethodSelector data={data} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />
              {!hasPending && data.billingEnabled && <form onSubmit={submitReceipt} className="mt-5 space-y-3"><ReceiptInput /><Button type="submit" disabled={busy || !selectedPlan}>{busy && <LoaderCircle className="animate-spin" size={16} />}{t("billing.submitSubscription")}</Button></form>}
              {hasPending && <p className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t("billing.pendingRequest")}</p>}
            </> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">{t("billing.noPlans")}</p>}
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 p-5"><h2 className="flex items-center gap-2 font-bold text-navy"><Clock3 size={18} className="text-teal" />{t("billing.requestsTitle")}</h2><div className="mt-3 space-y-3">{[...(data?.requests ?? []).map((item) => ({ ...item, title: item.planNameSnapshot, detail: t(cycleLabel(item.billingCycleSnapshot) as never) })), ...(data?.addonRequests ?? []).map((item) => ({ ...item, title: `${resourceLabel(item.resourceType).startsWith("billing.") ? t(resourceLabel(item.resourceType) as never) : resourceLabel(item.resourceType)} × ${item.quantity}`, detail: t("billing.addon") }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => <article key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="flex items-center justify-between gap-2"><strong>{item.title}</strong><span className="rounded-full bg-white px-2 py-1 text-xs">{requestStatus(item.status).startsWith("billing.") ? t(requestStatus(item.status) as never) : requestStatus(item.status)}</span></div><p className="mt-1 text-slate-600">{formatMoney(item.amountMinor, item.currency, locale)} · {item.detail} · {item.paymentMethod === "instapay" ? t("billing.instapay") : t("billing.vodafoneCash")}</p><p className="mt-1 text-xs text-slate-500">{t("billing.sent")}: {formatDate(item.createdAt, locale)}</p>{item.rejectionReason && <p className="mt-2 text-xs text-red-700">{item.rejectionReason}</p>}</article>)}{!data?.requests.length && !data?.addonRequests.length && <p className="text-sm text-slate-500">{t("billing.noRequests")}</p>}</div></div>
            <div className="rounded-2xl border border-slate-200 p-5"><h2 className="flex items-center gap-2 font-bold text-navy"><BadgeCheck size={18} className="text-teal" />{t("billing.invoicesTitle")}</h2><div className="mt-3 space-y-3">{data?.invoices.length ? data.invoices.map((invoice) => <article key={invoice.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="flex items-center justify-between gap-2"><strong>{invoice.invoiceNumber}</strong><span className="font-semibold text-navy">{formatMoney(invoice.amountMinor, invoice.currency, locale)}</span></div><p className="mt-1 text-slate-600">{invoice.planNameSnapshot} · {invoice.paymentMethod === "instapay" ? t("billing.instapay") : t("billing.vodafoneCash")}</p><p className="mt-1 text-xs text-slate-500">{t("billing.period")}: {formatDate(invoice.periodStart, locale)} — {formatDate(invoice.periodEnd, locale)}</p></article>) : <p className="text-sm text-slate-500">{t("billing.noInvoices")}</p>}</div></div>
          </div>
        </div>
        {data?.addOns.length ? <div className="mt-6 rounded-2xl border border-teal/20 bg-teal/[0.025] p-5"><h2 className="text-lg font-bold text-navy">{t("billing.addonsTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("billing.addonsDescription")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(data.usage).map(([key, value]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><strong>{resourceLabel(key).startsWith("billing.") ? t(resourceLabel(key) as never) : resourceLabel(key)}</strong><p className="mt-1 text-slate-600">{t("billing.used")}: {value.used}{value.limit !== null ? ` / ${value.limit}` : ""}{value.available !== null ? ` · ${t("billing.available")}: ${value.available}` : ""}</p></div>)}</div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2"><div><label className="block text-sm font-medium text-slate-700">{t("billing.addonPlan")}<select value={selectedAddon} onChange={(event) => setSelectedAddon(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">{t("billing.chooseAddon")}</option>{data.addOns.map((addon) => <option key={addon.id} value={addon.id}>{catalogName(addon, locale === "ar" ? "ar" : "en")} · {formatMoney(addon.priceMinor, addon.currency, locale)} / {cycleLabel(addon.billingCycle).startsWith("billing.") ? t(cycleLabel(addon.billingCycle) as never) : cycleLabel(addon.billingCycle)}</option>)}</select></label><label className="mt-3 block text-sm font-medium text-slate-700">{t("billing.quantity")}<input type="number" min="1" max="25" value={addonQuantity} onChange={(event) => setAddonQuantity(Math.max(1, Math.min(25, Number(event.target.value) || 1)))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>{selectedAddonPlan && <p className="mt-3 rounded-xl bg-white p-3 text-sm leading-6 text-slate-600">{t("billing.fullCyclePrice")}: {formatMoney(selectedAddonPlan.priceMinor * addonQuantity, selectedAddonPlan.currency, locale)}.{addonQuote ? <> {t("billing.amountDue")}: <strong className="text-navy">{formatMoney(addonQuote.amountMinor, addonQuote.currency, locale)}</strong> {t("billing.until")} {formatDate(addonQuote.subscriptionEndsAt, locale)}.</> : quoteError ? <span role="alert" className="text-red-700"> {quoteError}</span> : <span className="inline-flex items-center gap-1"><LoaderCircle size={13} className="animate-spin" /> {t("billing.calculating")}</span>}</p>}</div>
            <div><PaymentMethodSelector data={data} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} /><form onSubmit={submitAddonReceipt} className="mt-4 space-y-3"><ReceiptInput /><Button type="submit" disabled={busy || !data.canPurchaseAddons || !selectedAddonPlan || !addonQuote || hasPending || !data.billingEnabled}>{busy && <LoaderCircle className="animate-spin" size={16} />}{t("billing.submitAddon")}</Button>{!data.canPurchaseAddons && <p className="text-xs text-amber-800">{t("billing.addonsEligibility")}</p>}</form></div></div>
          <div className="mt-5"><h3 className="font-bold text-navy">{t("billing.activeAddons")}</h3><div className="mt-3 space-y-2">{data.resourceAddons.filter((grant) => grant.active).length ? data.resourceAddons.filter((grant) => grant.active).map((grant) => <article key={grant.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-white p-3 text-sm"><strong>{resourceLabel(grant.resourceType)} · +{grant.quantity}</strong><span className="text-slate-500">{t("billing.validUntil")} {formatDate(grant.endsAt, locale)}</span></article>) : <p className="text-sm text-slate-500">{t("billing.noActiveAddons")}</p>}</div></div>
        </div> : null}
      </>}
    </div>
  </section>;
}

function PaymentMethodSelector({ data, paymentMethod, setPaymentMethod }: { data: BillingData; paymentMethod: string; setPaymentMethod: (value: string) => void }) {
  const t = useTranslations("remaining-platform-print");
  return <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className={`cursor-pointer rounded-xl border p-3 text-sm ${paymentMethod === "vodafone_cash" ? "border-teal bg-teal/5" : "border-slate-200"}`}><input className="ml-2" type="radio" checked={paymentMethod === "vodafone_cash"} onChange={() => setPaymentMethod("vodafone_cash")} />{t("billing.vodafoneCash")}{data.settings.vodafoneCashNumber && <span className="mt-2 block select-all font-semibold text-navy" dir="ltr">{data.settings.vodafoneCashNumber}</span>}</label><label className={`cursor-pointer rounded-xl border p-3 text-sm ${paymentMethod === "instapay" ? "border-teal bg-teal/5" : "border-slate-200"}`}><input className="ml-2" type="radio" checked={paymentMethod === "instapay"} onChange={() => setPaymentMethod("instapay")} />{t("billing.instapay")}{data.settings.instapayQrUrl && <a href={data.settings.instapayQrUrl} target="_blank" rel="noreferrer" className="mt-2 block text-teal underline">{t("billing.showQr")}</a>}</label></div>;
}

function ReceiptInput() {
  const t = useTranslations("remaining-platform-print");
  return <label className="block text-sm font-medium text-slate-700">{t("billing.receiptLabel")}<span className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 text-sm text-slate-500"><FileImage size={18} /><input required name="receipt" type="file" accept="image/jpeg,image/png,image/webp" className="min-w-0 text-xs" /></span></label>;
}

function statusLabel(status: string): string { const labels: Record<string, string> = { pending_trial: "billing.status.pendingTrial", active_trial: "billing.status.activeTrial", active: "billing.status.active", grace: "billing.status.grace", expired: "billing.status.expired", frozen: "billing.status.frozen", cancelled: "billing.status.cancelled" }; return labels[status] ?? status; }
function cycleLabel(cycle: string): string { const labels: Record<string, string> = { monthly: "billing.cycle.monthly", quarterly: "billing.cycle.quarterly", semi_annual: "billing.cycle.semiAnnual", annual: "billing.cycle.annual", custom_days: "billing.cycle.custom" }; return labels[cycle] ?? cycle; }
function requestStatus(status: string): string { const labels: Record<string, string> = { pending_review: "billing.requestStatus.pending", approved: "billing.requestStatus.approved", rejected: "billing.requestStatus.rejected", expired: "billing.requestStatus.expired", cancelled: "billing.requestStatus.cancelled" }; return labels[status] ?? status; }
function resourceLabel(key: string): string { const labels: Record<string, string> = { warehouse: "billing.resources.warehouse", branch: "billing.resources.branch", doctor: "billing.resources.doctor", user: "billing.resources.user" }; return labels[key] ?? key; }
