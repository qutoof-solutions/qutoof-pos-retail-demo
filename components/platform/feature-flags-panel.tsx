"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Flag, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/components/platform/api-client";
import { featureFlagCopy } from "@/components/platform/feature-flag-labels";

type Feature = { key: string; label: string; description: string; enabled: boolean; updatedAt: string; updatedBy: string | null };
export function FeatureFlagsPanel() {
  const t = useTranslations("platformAdmin");
  const locale = useLocale();
  const [flags, setFlags] = useState<Feature[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setFlags((await apiRequest<{ flags: Feature[] }>("/api/super-admin/feature-flags")).flags); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("features.loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  async function toggle(flag: Feature) {
    const next = !flag.enabled;
    if (flag.key === "maintenance_mode" && next && !window.confirm(t("features.confirmMaintenance"))) return;
    if (flag.key === "subscription_billing" && !next && !window.confirm(t("features.confirmDisableBilling"))) return;
    setBusyKey(flag.key); setError(""); setNotice("");
    try { await apiRequest(`/api/super-admin/feature-flags`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: flag.key, enabled: next }) }); setFlags((current) => current.map((item) => item.key === flag.key ? { ...item, enabled: next, updatedAt: new Date().toISOString() } : item)); setNotice(next ? t("features.enabledNotice") : t("features.disabledNotice")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("features.updateError")); }
    finally { setBusyKey(""); }
  }
  return <section className="mx-auto max-w-4xl space-y-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("features.generalManagement")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("features.title")}</h1><p className="mt-2 text-sm text-slate-600">{t("features.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={16} />{t("common.refresh")}</Button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    <div className="space-y-3">{flags.map((flag) => { const copy = featureFlagCopy(flag.key); return <article key={flag.key} className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${flag.key === "maintenance_mode" && flag.enabled ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"><Flag size={19} /></span><div><h2 className="font-bold text-navy">{t(copy.label)}<code dir="ltr" className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">{flag.key}</code></h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{t(copy.description)}{locale === "ar" && flag.description && copy.label === "features.flags.unknown.label" ? ` (${flag.description})` : ""}</p></div></div><Button variant={flag.enabled ? "outline" : "default"} disabled={busyKey === flag.key} onClick={() => void toggle(flag)}>{busyKey === flag.key ? <LoaderCircle className="animate-spin" size={15} /> : null}{flag.enabled ? t("features.enabledTurnOff") : t("features.disabledTurnOn")}</Button></article>; })}{!flags.length && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{t("features.empty")}</p>}</div>
  </section>;
}
