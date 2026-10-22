"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiRequest, Notice, ModuleTitle } from "@/components/operations/shared";
import { Button } from "@/components/ui/button";
import { BarcodeCamera } from "@/components/operations/barcode-camera";
import { Camera, CheckCircle2, ScanLine } from "lucide-react";

type Result = { customerName: string; serviceName: string; startsAt: string; endsAt: string; checkedInAt: string };
export function GateCheckinPanel() {
  const t = useTranslations("queue-gate-attendance");
  const locale = useLocale();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  async function checkIn(value = token, method: "qr" | "manual" = "manual") {
    const clean = value.trim(); if (!clean) return; setBusy(true); setError(""); setResult(null);
    try { const response = await apiRequest<{ checkIn: Result }>("/api/ops/gate/check-in", { method: "POST", body: JSON.stringify({ token: clean, method }) }); setResult(response.checkIn); setToken(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("gate.errors.verify")); }
    finally { setBusy(false); }
  }
  return <section><ModuleTitle eyebrow={t("gate.eyebrow")} title={t("gate.title")} description={t("gate.description")} /><div className="mx-auto max-w-3xl space-y-5"><article className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap gap-3"><input autoFocus value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void checkIn(); }} placeholder={t("gate.tokenPlaceholder")} dir="ltr" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal" /><Button disabled={busy || !token.trim()} onClick={() => void checkIn()}><ScanLine size={17} /> {t("gate.manualVerify")}</Button><Button variant="outline" onClick={() => setCameraOpen(true)}><Camera size={17} /> {t("gate.openCamera")}</Button></div><p className="mt-3 text-xs text-slate-500">{t("gate.windowNote")}</p>{error && <div className="mt-4"><Notice>{error}</Notice></div>}{result && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex items-center gap-2 font-bold"><CheckCircle2 size={20} /> {t("gate.accepted")}</div><p className="mt-3 text-lg font-bold">{result.customerName}</p><p className="mt-1 text-sm">{result.serviceName}</p><p className="mt-1 text-sm">{new Date(result.startsAt).toLocaleString(locale === "en" ? "en-GB" : "ar-EG-u-nu-latn")} – {new Date(result.endsAt).toLocaleTimeString(locale === "en" ? "en-GB" : "ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}</p><p className="mt-3 text-xs">{t("gate.reuseNote")}</p></div>}</article><article className="rounded-2xl border border-teal/20 bg-teal/5 p-5 text-sm leading-7 text-slate-700"><strong className="text-navy">{t("gate.security")}</strong><ul className="mt-2 list-disc pr-5"><li>{t("gate.securityRaw")}</li><li>{t("gate.securityAtomic")}</li><li>{t("gate.securityAudit")}</li></ul></article></div>{cameraOpen && <BarcodeCamera onClose={() => setCameraOpen(false)} onDetected={(value) => { setCameraOpen(false); void checkIn(value, "qr"); }} />}</section>;
}
