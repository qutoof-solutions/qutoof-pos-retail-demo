"use client";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, InputField, Notice } from "@/components/operations/shared";
import { useLocale, useTranslations } from "next-intl";

export function MedicalSettingsModule() {
  const locale = useLocale();
  const t = useTranslations("medical");
  const en = locale === "en";
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void apiRequest<{ followUpDays: number }>("/api/ops/medical-settings").then((data) => setDays(String(data.followUpDays))).catch((cause) => setError(cause instanceof Error ? cause.message : t("settingsLoadFailed"))); }, [t]);

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const value = Number(days);
      await apiRequest("/api/ops/medical-settings", { method: "PUT", body: JSON.stringify({ followUpDays: value }) });
      setMessage(t("settingsSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settingsSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" dir={en ? "ltr" : "rtl"}><h2 className="font-bold text-navy">{t("followUpSettings")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("followUpHelp")}</p><div className="mt-4 flex flex-wrap items-end gap-3"><InputField label={t("followUpDays")} type="number" min="0" max="90" step="1" value={days} onChange={setDays} /><Button type="button" disabled={busy} onClick={() => void save()}><Save size={16} />{t("save")}</Button></div>{message && <p role="status" className="mt-3 text-sm text-teal">{message}</p>}{error && <div className="mt-3"><Notice>{error}</Notice></div>}</section>;
}
