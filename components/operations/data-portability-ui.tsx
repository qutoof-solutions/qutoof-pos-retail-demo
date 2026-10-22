"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileDown, FileSpreadsheet, Globe2, LoaderCircle } from "lucide-react";
import type { ExportDataset, DataLocale } from "@/lib/operations/data-portability";
import { createLocaleCookie, LOCALE_STORAGE_KEY, localeDirection, readAppLocaleCookie, type AppLocale } from "@/lib/i18n/locale-cookie";
import { useTranslations } from "next-intl";

type LocaleContextValue = { locale: AppLocale; setLocale: (locale: AppLocale) => void };
const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): AppLocale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return value === "ar" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

function saveStoredLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private browsing or blocked storage should not block locale persistence in the cookie.
  }
}

export function DataLocaleProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale: AppLocale }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);
  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 120);
  }, [router]);
  useEffect(() => {
    const syncFromStoredLocale = () => {
      const stored = readStoredLocale();
      const next = stored ?? readAppLocaleCookie(document.cookie);
      if (stored && readAppLocaleCookie(document.cookie) !== stored) document.cookie = createLocaleCookie(stored, window.location.protocol === "https:");
      if (locale === next) return;
      setLocaleState(next);
      document.documentElement.lang = next;
      document.documentElement.dir = localeDirection(next);
      scheduleRefresh();
    };
    syncFromStoredLocale();
    window.addEventListener("focus", syncFromStoredLocale);
    window.addEventListener("pageshow", syncFromStoredLocale);
    return () => {
      window.removeEventListener("focus", syncFromStoredLocale);
      window.removeEventListener("pageshow", syncFromStoredLocale);
    };
  }, [locale, scheduleRefresh]);
  useEffect(() => () => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);
  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    saveStoredLocale(next);
    document.cookie = createLocaleCookie(next, window.location.protocol === "https:");
    document.documentElement.lang = next;
    document.documentElement.dir = localeDirection(next);
    window.dispatchEvent(new Event("qutoof-locale-change"));
    scheduleRefresh();
  }, [scheduleRefresh]);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useDataLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("DataLocaleProvider is missing.");
  return value;
}

export function DataLanguageToggle({ compact = false, titleKey = "interfaceLanguage" }: { compact?: boolean; titleKey?: "toolsLanguage" | "interfaceLanguage" }) {
  const { locale, setLocale } = useDataLocale();
  const t = useTranslations("language");
  const next = locale === "ar" ? "en" : "ar";
  return <button type="button" onClick={() => setLocale(next)} aria-label={locale === "ar" ? t("switchToEnglish") : t("switchToArabic")} title={t(titleKey)} className={`inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 transition hover:border-teal dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${compact ? "min-w-[44px] justify-center gap-1 px-1.5" : "gap-1.5 px-2.5"}`}><Globe2 size={15} /><span>{compact ? (locale === "ar" ? "EN" : "ع") : (locale === "ar" ? t("english") : t("arabic"))}</span></button>;
}

type ExportColumn = { key: string; label: string };
type ExportPayload = { dataset: ExportDataset; title: string; generatedAt: string; columns: ExportColumn[]; rows: Array<Record<string, string | number | null>>; truncated: boolean };
type DataExportActionsProps = { dataset: ExportDataset; params?: Record<string, string>; className?: string };

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function printDocument(payload: ExportPayload, locale: DataLocale, copy: { printSavePdf: string; exported: string; recordsLabel: string; truncated: string }): string {
  const direction = locale === "ar" ? "rtl" : "ltr";
  const generated = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt));
  const headers = payload.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = payload.rows.map((row) => `<tr>${payload.columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  const warning = payload.truncated ? `<p class="warning">${escapeHtml(copy.truncated)}</p>` : "";
  return `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(payload.title)}</title><style>
    @page{size:auto;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,"Readex Pro",sans-serif;color:#0f172a;margin:0;font-size:10pt}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0d9488;padding-bottom:12px;margin-bottom:16px}h1{font-size:19pt;margin:0 0 6px}.meta{font-size:9pt;color:#475569}.warning{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;padding:8px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:8.5pt}th,td{border:1px solid #cbd5e1;padding:6px;text-align:start;vertical-align:top;overflow-wrap:anywhere}th{background:#e2e8f0;color:#0f172a}tbody tr:nth-child(even){background:#f8fafc}.count{color:#475569;font-size:9pt}@media screen{body{padding:24px}.toolbar{display:flex;gap:8px;margin-bottom:14px}.toolbar button{border:0;border-radius:8px;background:#0d9488;color:#fff;padding:9px 14px;cursor:pointer}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">${escapeHtml(copy.printSavePdf)}</button></div><header><div><h1>${escapeHtml(payload.title)}</h1><div class="meta">${escapeHtml(copy.exported)}: ${escapeHtml(generated)}</div></div><div class="count">${payload.rows.length.toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US")} ${escapeHtml(copy.recordsLabel)}</div></header>${warning}<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
}

export function DataExportActions({ dataset, params = {}, className = "" }: DataExportActionsProps) {
  const { locale } = useDataLocale();
  const t = useTranslations("dataExport");
  const [busy, setBusy] = useState<"xlsx" | "csv" | "pdf" | null>(null);
  const [message, setMessage] = useState("");
  const labels = { xlsx: t("xlsx"), csv: t("csv"), pdf: t("pdf"), working: t("working"), popup: t("popup"), truncated: t("truncated"), error: t("error") };
  const pdfCopy = { printSavePdf: t("printSavePdf"), exported: t("exported"), recordsLabel: t("recordsLabel"), truncated: t("printTruncated") };
  const makeUrl = (format: "xlsx" | "csv" | "json") => {
    const query = new URLSearchParams({ ...params, format, locale });
    return `/api/ops/data-export/${dataset}?${query.toString()}`;
  };
  async function exportFile(format: "xlsx" | "csv") {
    setBusy(format); setMessage("");
    try {
      const response = await fetch(makeUrl(format), { cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? labels.error); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `qutoof-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (response.headers.get("X-Export-Truncated") === "true") setMessage(labels.truncated);
    } catch (error) { setMessage(error instanceof Error ? error.message : labels.error); }
    finally { setBusy(null); }
  }
  async function exportPdf() {
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setMessage(labels.popup); return; }
    popup.document.write(`<p style="font-family:Arial;padding:2rem">${escapeHtml(labels.working)}</p>`);
    setBusy("pdf"); setMessage("");
    try {
      const response = await fetch(makeUrl("json"), { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as ExportPayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? labels.error);
      popup.document.open(); popup.document.write(printDocument(body, locale, pdfCopy)); popup.document.close();
      if (body.truncated) setMessage(labels.truncated);
    } catch (error) {
      popup.close(); setMessage(error instanceof Error ? error.message : labels.error);
    } finally { setBusy(null); }
  }
  return <div className={`flex flex-wrap items-center gap-2 ${className}`} dir={locale === "ar" ? "rtl" : "ltr"}>
    <button type="button" onClick={() => void exportFile("xlsx")} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:border-teal disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><FileSpreadsheet size={16} />{busy === "xlsx" ? labels.working : labels.xlsx}</button>
    <button type="button" onClick={() => void exportFile("csv")} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:border-teal disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Download size={16} />{busy === "csv" ? labels.working : labels.csv}</button>
    <button type="button" onClick={() => void exportPdf()} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal px-3 text-sm font-semibold text-white transition hover:bg-teal/90 disabled:opacity-50"><FileDown size={16} />{busy === "pdf" ? labels.working : labels.pdf}</button>
    {message && <span role="status" className="basis-full text-xs text-slate-600 dark:text-slate-300">{message}</span>}
    {busy && <LoaderCircle className="animate-spin text-teal" size={16} aria-label={labels.working} />}
  </div>;
}
