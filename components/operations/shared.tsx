"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "next-intl";

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers }, cache: "no-store" });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "");
  return result;
}

export function useLoad<T>(url: string, refreshKey = 0) {
  const t = useTranslations("common");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await apiRequest<T>(url)); setError(""); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("error")); }
    finally { setLoading(false); }
  }, [url, t]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  return { data, error, loading, reload, setData };
}

export function ModuleTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold text-teal">{eyebrow}</p><h1 className="mt-1 text-2xl font-bold text-navy dark:text-slate-100">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p></div>{action}</div>;
}

export function Notice({ children, kind = "error" }: { children: React.ReactNode; kind?: "error" | "success" | "info" }) {
  const styles = { error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200", success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", info: "border-teal/20 bg-teal/5 text-teal dark:border-teal/40 dark:bg-teal/10 dark:text-teal-200" };
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${styles[kind]}`}>{children}</p>;
}

export function Loading() { const t = useTranslations("common"); const locale = useLocale(); return <div dir={locale === "ar" ? "rtl" : "ltr"} className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-300"><LoaderCircle className="animate-spin" size={18} /> {t("loading")}</div>; }

export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-900"><p className="font-semibold text-navy dark:text-slate-100">{title}</p><p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{detail}</p></div>; }

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations("common");
  const locale = useLocale();
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} dir={locale === "ar" ? "rtl" : "ltr"} className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><motion.section initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.99 }} transition={{ duration: 0.2, ease: "easeOut" }} role="dialog" aria-modal="true" aria-label={title} className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:max-w-2xl sm:rounded-3xl sm:p-7"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold text-navy dark:text-slate-100">{title}</h2><Button type="button" variant="ghost" size="sm" onClick={onClose}>{t("close")}</Button></div>{children}</motion.section></motion.div>;
}

export function InputField({ label, value, onChange, type = "text", required, min, max, step, placeholder, readOnly, lang, dir }: { label: string; value: string | number; onChange?: (value: string) => void; type?: string; required?: boolean; min?: string | number; max?: string | number; step?: string | number; placeholder?: string; readOnly?: boolean; lang?: string; dir?: "ltr" | "rtl" | "auto" }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span><input type={type} lang={lang} dir={dir} value={value} onChange={(event) => onChange?.(event.target.value)} required={required} min={min} max={max} step={step} placeholder={placeholder} readOnly={readOnly} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/15 read-only:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:read-only:bg-slate-800" /></label>;
}

export function SelectField({ label, value, onChange, options, required, disabled }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; required?: boolean; disabled?: boolean }) {
  const t = useTranslations("common");
  const locale = useLocale();
  return <label dir={locale === "ar" ? "rtl" : "ltr"} className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal focus:ring-2 focus:ring-teal/15 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800"><option value="">{t("select")}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function formatMoney(minor: number | null | undefined, locale: string = "ar"): string {
  const numberLocale = locale === "en" ? "en-GB" : "ar-EG";
  return new Intl.NumberFormat(numberLocale, { style: "currency", currency: "EGP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((minor ?? 0) / 100);
}

export function formatDate(value: string | Date, withTime = true, locale: string = "ar"): string {
  const date = value instanceof Date ? value : new Date(value);
  const numberLocale = locale === "en" ? "en-GB" : "ar-EG";
  return new Intl.DateTimeFormat(numberLocale, { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(date);
}

export function useAction() {
  const t = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const execute = useCallback(async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    setBusy(true); setError(""); setSuccess("");
    try { const value = await action(); if (successMessage) setSuccess(successMessage); return value; }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("error")); return null; }
    finally { setBusy(false); }
  }, [t]);
  return { busy, error, success, execute, setError, setSuccess };
}
