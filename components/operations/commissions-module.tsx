"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Coins, RefreshCw, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

type ProviderCommission = { providerId: string | null; providerName: string; commissionMinor: number; grossMinor: number; invoiceCount: number; lineCount: number };
type Report = { period: "daily" | "monthly"; range: { from: string; to: string; timezone: string; currency: string }; totals: { commissionMinor: number; grossMinor: number }; providers: ProviderCommission[] };
function localDate(timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const pick = (key: string) => parts.find((part) => part.type === key)?.value ?? ""; return `${pick("year")}-${pick("month")}-${pick("day")}`; }
function money(minor: number, currency: string, locale: string) { return new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-EG", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100); }

export function CommissionsModule({ timezone }: { timezone: string }) {
  const t = useTranslations("reports-distribution-treasury");
  const locale = useLocale();
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [date, setDate] = useState(localDate(timezone));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const today = localDate(timezone); setDate(today); }, [timezone]);
  useEffect(() => {
    const value = period === "monthly" ? date.slice(0, 7) : date;
    const controller = new AbortController(); setLoading(true); setError("");
    void fetch(`/api/ops/commissions?period=${period}&date=${encodeURIComponent(value)}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error ?? t("commissionsLoadError"));
      setReport(data);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("reportLoadError")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, date, t]);
  const dateInput = period === "monthly" ? date.slice(0, 7) : date;
  return <section className="space-y-6">
    <header><p className="text-sm font-semibold text-teal">{t("variablePayroll")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("commissionsSummary")}</h1><p className="mt-2 text-sm text-slate-600">{t("commissionsDescription")}</p></header>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex gap-2"><Button type="button" variant={period === "daily" ? "default" : "outline"} size="sm" onClick={() => setPeriod("daily")}>{t("daily")}</Button><Button type="button" variant={period === "monthly" ? "default" : "outline"} size="sm" onClick={() => setPeriod("monthly")}>{t("monthly")}</Button></div><label className="text-sm font-semibold text-navy">{period === "daily" ? t("day") : t("month")}<input type={period === "daily" ? "date" : "month"} value={dateInput} onChange={(event) => setDate(period === "monthly" ? `${event.target.value}-01` : event.target.value)} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label><span className="text-xs text-slate-500">{t("timezone")}: {timezone}</span></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl bg-navy p-5 text-white"><span className="flex items-center gap-2 text-sm text-slate-300"><Coins size={18} />{t("totalCommissions")}</span><strong className="mt-3 block text-2xl">{money(report?.totals.commissionMinor ?? 0, report?.range.currency ?? "EGP", locale)}</strong></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><span className="flex items-center gap-2 text-sm text-slate-500"><CalendarDays size={18} />{t("grossBeforeCommission")}</span><strong className="mt-3 block text-2xl text-navy">{money(report?.totals.grossMinor ?? 0, report?.range.currency ?? "EGP", locale)}</strong></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><span className="flex items-center gap-2 text-sm text-slate-500"><UsersRound size={18} />{t("serviceProviders")}</span><strong className="mt-3 block text-2xl text-navy">{report?.providers.filter((row) => row.providerId).length ?? 0}</strong></article></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><h2 className="font-bold text-navy">{t("detailByProvider")}</h2>{loading && <RefreshCw size={17} className="animate-spin text-teal" />}</div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">{t("provider")}</th><th className="p-3">{t("grossAfterDiscount")}</th><th className="p-3">{t("commission")}</th><th className="p-3">{t("invoices")}</th><th className="p-3">{t("lineItems")}</th></tr></thead><tbody>{report?.providers.map((row) => <tr key={row.providerId ?? "unassigned"} className="border-t border-slate-100"><td className="p-3 font-semibold text-navy">{row.providerName}</td><td className="p-3">{money(row.grossMinor, report.range.currency, locale)}</td><td className="p-3 font-bold text-teal">{money(row.commissionMinor, report.range.currency, locale)}</td><td className="p-3">{row.invoiceCount}</td><td className="p-3">{row.lineCount}</td></tr>)}{!loading && report?.providers.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">{t("noPaidInvoices")}</td></tr>}</tbody></table></div><p className="border-t border-slate-100 p-3 text-xs leading-6 text-slate-500">{t("commissionNote")}</p></div>
  </section>;
}
