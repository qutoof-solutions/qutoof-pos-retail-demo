"use client";

import { PRODUCT_NAME } from "@/lib/brand";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, Building2, CalendarDays, CircleDollarSign, Clock3, LoaderCircle, RefreshCw, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatMoney } from "@/components/platform/api-client";

type Overview = { totalTenants: number; statuses: Record<string, number>; revenueMinor: number; bookings: number; pendingBillingRequests: number };
const statusKeys = { active: "overview.statusActive", active_trial: "overview.statusTrial", pending_trial: "overview.statusPendingTrial", grace: "overview.statusGrace", expired: "overview.statusExpired", frozen: "overview.statusFrozen", cancelled: "overview.statusCancelled" } as const;

export function OverviewPanel({ onOpenBilling }: { onOpenBilling: () => void }) {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await apiRequest<Overview>("/api/super-admin/overview")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("overview.loadError")); }
    finally { setBusy(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const numberLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  const cards = data ? [
    { label: t("overview.totalTenants"), value: new Intl.NumberFormat(numberLocale).format(data.totalTenants), icon: Building2 },
    { label: t("overview.approvedSubscriptionRevenue"), value: formatMoney(data.revenueMinor, "EGP", locale), icon: CircleDollarSign },
    { label: t("overview.totalBookings"), value: new Intl.NumberFormat(numberLocale).format(data.bookings), icon: CalendarDays },
    { label: t("overview.pendingReviews"), value: new Intl.NumberFormat(numberLocale).format(data.pendingBillingRequests), icon: ReceiptText },
  ] : [];
  return <section className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{PRODUCT_NAME} · {t("overview.platform")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("overview.title")}</h1><p className="mt-2 text-sm text-slate-600">{t("overview.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={16} className={busy ? "animate-spin" : ""} />{t("common.refresh")}</Button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!data && !error && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />{t("overview.loading")}</div>}
    {data && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon }) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><Icon size={20} /></span><p className="mt-4 text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-navy">{value}</p></article>)}</div>
      <div className="grid gap-5 lg:grid-cols-[1fr_.85fr]"><article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="flex items-center gap-2 font-bold text-navy"><Activity size={18} className="text-teal" />{t("overview.tenantStatuses")}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(statusKeys).map(([key, labelKey]) => <div key={key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm text-slate-600">{t(labelKey)}</span><strong className="text-navy">{new Intl.NumberFormat(numberLocale).format(data.statuses[key] ?? 0)}</strong></div>)}</div></article>
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="flex items-center gap-2 font-bold text-amber-950"><Clock3 size={18} />{t("overview.reviewRequired")}</h2><p className="mt-2 text-sm leading-7 text-amber-900">{data.pendingBillingRequests ? `${t("overview.pendingTransferPrefix")} ${new Intl.NumberFormat(numberLocale).format(data.pendingBillingRequests)} ${t("overview.pendingTransferSuffix")}` : t("overview.noPendingTransfers")}</p><Button className="mt-4" onClick={onOpenBilling}>{t("overview.openBillingRequests")}</Button></article></div></>}
  </section>;
}
