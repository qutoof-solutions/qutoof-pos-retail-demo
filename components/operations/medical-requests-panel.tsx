"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, Notice } from "@/components/operations/shared";
import { useLocale, useTranslations } from "next-intl";

export function MedicalRequestsPanel({ customerId, encounterId, disabled }: { customerId: string; encounterId?: string; disabled?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("medical");
  const en = locale === "en";
  const [type, setType] = useState<"lab" | "radiology">("lab");
  const [tests, setTests] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const values = tests.split(/[\n,،]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) { setError(t("addRequest")); return; }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/api/ops/medical", { method: "POST", body: JSON.stringify({ action: "lab", customerId, encounterId: encounterId ?? null, requestType: type, tests: values, clinicalNotes: notes.trim() || null }) });
      setTests("");
      setNotes("");
      setMessage(t("requestSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("requestSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="no-print rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" dir={en ? "ltr" : "rtl"}><h4 className="font-bold text-navy">{t("labRadiology")}</h4><p className="mt-1 text-xs leading-5 text-slate-600">{t("requestDescription")}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">{t("requestType")}<select value={type} onChange={(event) => setType(event.target.value as "lab" | "radiology")} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="lab">{t("laboratory")}</option><option value="radiology">{t("radiology")}</option></select></label><label className="text-sm font-medium text-slate-700">{t("tests")}<textarea required value={tests} onChange={(event) => setTests(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm" /></label></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm" placeholder={t("clinicalNotes")} /><Button className="mt-3" type="submit" disabled={busy || disabled || !encounterId}><Send size={15} />{t("saveRequest")}</Button>{message && <p role="status" className="mt-2 text-sm text-teal">{message}</p>}{error && <div className="mt-2"><Notice>{error}</Notice></div>}</form>;
}
