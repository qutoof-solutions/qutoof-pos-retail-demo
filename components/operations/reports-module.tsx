"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer, RefreshCw } from "lucide-react";
import { DataExportActions, useDataLocale } from "@/components/operations/data-portability-ui";
import { localizedBranchName } from "@/lib/i18n/branch-name";
import { Button } from "@/components/ui/button";

type Report = {
  period: { from: string; to: string; timezone: string };
  branches: Array<{ id: string; name: string; nameAr?: string; nameEn?: string }>;
  appointments: Array<{ status: string; count: number }>;
  invoices: Array<{ currency: string; status: string; paymentMethod: string; count: number; totalMinor: number; paidMinor: number }>;
  money: { collections: Array<{ paymentMethod: string; count: number; totalMinor: number }>; treasury: Array<{ direction: "in" | "out"; isOperatingExpense: boolean; count: number; totalMinor: number }>; customerCheques: Array<{ status: string; count: number; totalMinor: number }>; supplierCheques: Array<{ status: string; count: number; totalMinor: number }>; settlements: { count: number; differenceMinor: number } };
};
type ShiftSnapshot = { id: string; openedAt: string; closedAt: string | null; openingCashMinor: number; expectedCashMinor: number; countedCashMinor: number; cashDifferenceMinor: number; electronicTotalMinor: number; lines: Array<{ paymentMethod: string; expectedMinor: number; collectedMinor: number; differenceMinor: number; invoiceCount: number }>; adjustments: Array<{ paymentMethod: string; amountDeltaMinor: number; reason: string; createdAt: string }>; zReportSnapshot: { id: string; payloadHash: string; snapshotJson: string; createdAt: string } | null };
type ZReportPayload = { treasury?: { totals?: { incomingMinor: number; outgoingMinor: number; netMinor: number } }; cheques?: { incoming: { count: number; totalMinor: number }; outgoing: { count: number; totalMinor: number } }; shift?: { payments?: unknown[] }; interval?: { from: string; to: string; inclusiveFrom: boolean; exclusiveTo: boolean }; sourceTimestampPolicy?: Record<string, string> };
function printOnly(element: HTMLElement) {
  const marker = "data-z-report-print-target";
  const cleanup = () => { element.removeAttribute(marker); style.remove(); window.removeEventListener("afterprint", cleanup); };
  const style = document.createElement("style");
  style.textContent = `@media print { body * { visibility: hidden !important; } [${marker}], [${marker}] * { visibility: visible !important; } [${marker}] { position: absolute !important; inset: 0 !important; width: 100% !important; } }`;
  element.setAttribute(marker, "true"); document.head.appendChild(style); window.addEventListener("afterprint", cleanup, { once: true }); window.print(); window.setTimeout(cleanup, 1500);
}
function localDate(daysAgo: number): string { const date = new Date(); date.setDate(date.getDate() - daysAgo); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function ReportsModule() {
  const { locale } = useDataLocale();
  const ar = locale === "ar";
  const [from, setFrom] = useState(localDate(29));
  const [to, setTo] = useState(localDate(0));
  const [branchId, setBranchId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const t = useTranslations("reports-distribution-treasury");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from, to }); if (branchId.trim()) params.set("branchId", branchId.trim());
      const response = await fetch(`/api/ops/reports?${params}`, { cache: "no-store" });
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error ?? t("error"));
      setReport(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); }
    finally { setLoading(false); }
  }, [from, to, branchId, t]);
  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => (report?.invoices ?? []).reduce((acc, row) => { const key = row.currency; acc[key] ??= { total: 0, paid: 0, count: 0 }; acc[key]!.total += row.totalMinor; acc[key]!.paid += row.paidMinor; acc[key]!.count += row.count; return acc; }, {} as Record<string, { total: number; paid: number; count: number }>), [report]);
  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: t("statusDraft"), issued: t("statusIssued"), partially_paid: t("statusPartiallyPaid"), paid: t("statusPaid"), void: t("statusVoid"), pending: t("statusPending"), confirmed: t("statusConfirmed"), waiting: t("statusWaiting"), in_progress: t("statusInProgress"), completed: t("statusCompleted"), no_show: t("statusNoShow"), cancelled: t("statusCancelled"),
    };
    return labels[status] ?? status.replaceAll("_", " ");
  };
  const paymentLabel = (payment: string) => ({ cash: t("paymentCash"), card: t("paymentCard"), wallet: t("paymentWallet"), instapay: t("paymentInstapay"), mixed: t("paymentMixed"), unpaid: t("paymentUnpaid") }[payment] ?? payment);
  const exportParams = { from, to, ...(branchId ? { branchId } : {}) };
  const inputClass = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  const moneyFormat = (minor: number) => (minor / 100).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { maximumFractionDigits: 2 });
  const moneyCards = report ? [
    [t("payments"), (report.money?.collections ?? []).reduce((total, row) => total + row.totalMinor, 0)],
    [t("treasuryIn"), (report.money?.treasury ?? []).filter((row) => row.direction === "in").reduce((total, row) => total + row.totalMinor, 0)],
    [t("treasuryOut"), (report.money?.treasury ?? []).filter((row) => row.direction === "out").reduce((total, row) => total + row.totalMinor, 0)],
    [t("cheques"), [...(report.money?.customerCheques ?? []), ...(report.money?.supplierCheques ?? [])].reduce((total, row) => total + row.totalMinor, 0)],
    [t("differences"), report.money?.settlements?.differenceMinor ?? 0],
  ] as Array<[string, number]> : [];

  return <section className="space-y-6" dir={ar ? "rtl" : "ltr"}>
    <header><p className="text-xs font-bold uppercase tracking-wide text-teal">{t("eyebrow")}</p><h1 className="mt-1 text-2xl font-bold text-navy dark:text-white">{t("title")}</h1><p className="mt-2 max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">{t("description")}</p></header>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">{t("from")}<input className={inputClass} type="date" lang={locale === "ar" ? "ar-EG" : "en-GB"} dir={locale === "ar" ? "rtl" : "ltr"} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">{t("to")}<input className={inputClass} type="date" lang={locale === "ar" ? "ar-EG" : "en-GB"} dir={locale === "ar" ? "rtl" : "ltr"} value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">{t("branch")}<select className={inputClass} value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">{t("allBranches")}</option>{report?.branches.map((branch) => <option key={branch.id} value={branch.id}>{localizedBranchName(branch, locale)}</option>)}</select></label>
      <Button onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? "animate-spin" : ""} />{t("refresh")}</Button>
      <DataExportActions dataset="reports" params={exportParams} />
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
    {loading && !report && <p className="text-sm text-slate-500 dark:text-slate-400">{t("loading")}</p>}
    {report && <><p className="text-xs text-slate-500 dark:text-slate-400">{t("period")}: {report.period.from} — {report.period.to} · {t("timezone")}: {report.period.timezone}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(totals).map(([currency, value]) => <article key={currency} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{t("invoiceTotal")} · {currency}</p><p className="mt-2 text-xl font-bold text-navy dark:text-white">{(value.total / 100).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { maximumFractionDigits: 2 })}</p><p className="mt-2 text-sm text-teal">{t("collected")}: {(value.paid / 100).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { maximumFractionDigits: 2 })} · {value.count.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB")} {t("records")}</p></article>)}</div>
      <article className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="mb-4 font-bold text-navy dark:text-white">{t("moneySummary")}</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{moneyCards.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs text-slate-500 dark:text-slate-300">{label}</p><p className="mt-1 text-lg font-bold text-navy dark:text-white">{moneyFormat(value)}</p></div>)}</div><p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("settlements")}: {report.money?.settlements?.count ?? 0}</p></article>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="mb-4 font-bold text-navy dark:text-white">{t("appointments")}</h2>{report.appointments.length ? <table className="w-full text-sm"><thead><tr className={`${ar ? "text-right" : "text-left"} border-b border-slate-200 text-slate-500 dark:border-slate-700`}><th className="p-2">{t("status")}</th><th className="p-2">{t("count")}</th></tr></thead><tbody>{report.appointments.map((row) => <tr key={row.status} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="p-2 text-slate-800 dark:text-slate-100">{statusLabel(row.status)}</td><td className="p-2 text-slate-700 dark:text-slate-200">{row.count.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-US")}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-500">{t("noRows")}</p>}</article>
        <article className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="mb-4 font-bold text-navy dark:text-white">{t("invoices")}</h2>{report.invoices.length ? <table className="w-full text-sm"><thead><tr className={`${ar ? "text-right" : "text-left"} border-b border-slate-200 text-slate-500 dark:border-slate-700`}><th className="p-2">{t("status")}</th><th className="p-2">{t("payment")}</th><th className="p-2">{t("currency")}</th><th className="p-2">{t("count")}</th><th className="p-2">{t("collected")}</th></tr></thead><tbody>{report.invoices.map((row, index) => <tr key={`${row.currency}-${row.status}-${row.paymentMethod}-${index}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="p-2 text-slate-800 dark:text-slate-100">{statusLabel(row.status)}</td><td className="p-2 text-slate-700 dark:text-slate-200">{paymentLabel(row.paymentMethod)}</td><td className="p-2 text-slate-700 dark:text-slate-200">{row.currency}</td><td className="p-2 text-slate-700 dark:text-slate-200">{row.count.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-US")}</td><td className="p-2 text-slate-700 dark:text-slate-200">{(row.paidMinor / 100).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { maximumFractionDigits: 2 })}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-500">{t("noRows")}</p>}</article>
      </div>
    </>}
    <ZReportHistory branchId={branchId} locale={locale} />
  </section>;
}

function ZReportHistory({ branchId, locale }: { branchId: string; locale: string }) {
  const t = useTranslations("reports-distribution-treasury");
  const [snapshots, setSnapshots] = useState<ShiftSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!branchId) { setSnapshots([]); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/ops/settlements?branchId=${encodeURIComponent(branchId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(t("error"));
      const data = await response.json() as { history?: ShiftSnapshot[] };
      setSnapshots(data.history ?? []);
    } catch { setError(t("error")); }
    finally { setLoading(false); }
  }, [branchId, t]);
  useEffect(() => { void load(); }, [load]);
  const money = (minor: number) => new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  const dateTime = (value: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const payment = (value: string) => ({ cash: t("paymentCash"), card: t("paymentCard"), wallet: t("paymentWallet"), instapay: t("paymentInstapay"), cheque: t("paymentCheque") }[value] ?? t("paymentOther"));
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header><h2 className="text-lg font-bold text-navy dark:text-white">{t("zReportTitle")}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("zReportDescription")}</p></header>
    {!branchId && <p className="text-sm text-slate-500">{t("selectBranchForZReport")}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {loading && <p className="text-sm text-slate-500">{t("loading")}</p>}
    {!loading && branchId && !snapshots.length && <p className="text-sm text-slate-500">{t("noShiftSnapshots")}</p>}
    {snapshots.map((snapshot) => <article key={snapshot.id} className="break-inside-avoid rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      {(() => { let payload: ZReportPayload | null = null; try { payload = snapshot.zReportSnapshot ? JSON.parse(snapshot.zReportSnapshot.snapshotJson) as ZReportPayload : null; } catch { payload = null; } return <><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-navy dark:text-white">{t("zReportSnapshot")}</h3><p className="mt-1 text-xs text-slate-500" dir="ltr">{dateTime(snapshot.openedAt)} — {snapshot.closedAt ? dateTime(snapshot.closedAt) : "—"}</p>{snapshot.zReportSnapshot && <code className="mt-1 block break-all text-[10px] text-slate-400" dir="ltr">{snapshot.zReportSnapshot.payloadHash}</code>}</div><Button className="print:hidden" size="sm" variant="outline" onClick={(event) => { const card = event.currentTarget.closest("article"); if (card) printOnly(card as HTMLElement); }}><Printer size={15} />{t("printZReport")}</Button></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">{t("openingCash")}: {money(snapshot.openingCashMinor)}</p><p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">{t("expectedCash")}: {money(snapshot.expectedCashMinor)}</p><p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">{t("countedCash")}: {money(snapshot.countedCashMinor)}</p><p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">{t("cashDifference")}: {money(snapshot.cashDifferenceMinor)}</p></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{snapshot.lines.map((line) => <p key={line.paymentMethod} className="rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-700">{payment(line.paymentMethod)} · {t("collected")}: {money(line.collectedMinor)} · {t("difference")}: {money(line.differenceMinor)} · {line.invoiceCount} {t("records")}</p>)}</div>
      {payload && <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><p className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">{t("treasuryIn")}: {money(payload.treasury?.totals?.incomingMinor ?? 0)}</p><p className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">{t("treasuryOut")}: {money(payload.treasury?.totals?.outgoingMinor ?? 0)}</p><p className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">{t("cheques")}: {money((payload.cheques?.incoming.totalMinor ?? 0) + (payload.cheques?.outgoing.totalMinor ?? 0))}</p><p className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">{t("records")}: {(payload.shift?.payments ?? []).length}</p></div>}
      {!!snapshot.adjustments.length && <div className="mt-3"><h4 className="text-sm font-semibold">{t("adjustments")}</h4>{snapshot.adjustments.map((adjustment, index) => <p key={`${adjustment.createdAt}-${index}`} className="mt-1 text-xs text-slate-600">{payment(adjustment.paymentMethod)} · {money(adjustment.amountDeltaMinor)} · {adjustment.reason}</p>)}</div>}
      {payload?.interval && <p className="mt-3 text-[10px] text-slate-400" dir="ltr">{t("period")}: [{payload.interval.from}, {payload.interval.to}) · {t("payment")}: {payload.sourceTimestampPolicy?.payments ?? ""}</p>}</> })()}
    </article>)}
  </section>;
}
