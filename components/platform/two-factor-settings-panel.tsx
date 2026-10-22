"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, LoaderCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/components/platform/api-client";

type SecurityStatus = { enabled: boolean; recoveryCodesRemaining: number };
type Setup = { secret: string; otpauthUrl: string; expiresAt: number };

export function TwoFactorSettingsPanel() {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setStatus(await apiRequest<SecurityStatus>("/api/super-admin/security/two-factor")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("twoFactor.loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<Setup>("/api/super-admin/security/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", currentPassword }) });
      setSetup(result); setCode(""); setNotice(t("twoFactor.setupNotice"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("twoFactor.beginError")); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ enabled: boolean; recoveryCodes: string[] }>("/api/super-admin/security/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", currentPassword, code }) });
      setStatus({ enabled: result.enabled, recoveryCodesRemaining: result.recoveryCodes.length }); setRecoveryCodes(result.recoveryCodes); setSetup(null); setCode(""); setCurrentPassword("");
      setNotice(t("twoFactor.enabledNotice"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("twoFactor.verifyError")); }
    finally { setBusy(false); }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest<SecurityStatus>("/api/super-admin/security/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disable", currentPassword, code }) });
      setStatus({ enabled: false, recoveryCodesRemaining: 0 }); setSetup(null); setRecoveryCodes(null); setCode(""); setCurrentPassword(""); setNotice(t("twoFactor.disabledNotice"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("twoFactor.disableError")); }
    finally { setBusy(false); }
  }

  async function copyCodes() {
    if (!recoveryCodes) return;
    try { await navigator.clipboard.writeText(recoveryCodes.join("\n")); setNotice(t("twoFactor.copiedNotice")); }
    catch { setError(t("twoFactor.copyError")); }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-6" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="mb-5 flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"><ShieldCheck size={20} /></span><div><p className="text-sm font-semibold text-teal">{t("twoFactor.accountSecurity")}</p><h2 className="mt-1 text-xl font-bold text-navy">{t("twoFactor.title")}</h2><p className="mt-2 text-sm text-slate-600">{t("twoFactor.description")}</p></div></div>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    {!status ? <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={16} />{t("common.loading")}</div> : status.enabled ? <div className="space-y-4">
      <div className="rounded-xl bg-teal/5 p-4 text-sm text-teal"><strong>{t("twoFactor.protectionEnabled")}</strong> {t("twoFactor.remainingCodesPrefix")} {status.recoveryCodesRemaining}. {t("twoFactor.useCodeOnce")}</div>
      {recoveryCodes && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="font-bold text-amber-950">{t("twoFactor.recoveryCodesTitle")}</p><p className="text-sm text-amber-900">{t("twoFactor.recoveryCodesNote")}</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{recoveryCodes.map((item) => <code key={item} dir="ltr" className="rounded-lg bg-white px-3 py-2 text-center font-mono text-sm">{item}</code>)}</div><Button type="button" variant="outline" onClick={() => void copyCodes()}><Copy size={16} />{t("twoFactor.copyCodes")}</Button></div>}
      <form onSubmit={disable} className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="font-semibold text-navy">{t("twoFactor.disableTitle")}</h3><label className="block text-sm font-semibold text-navy">{t("twoFactor.currentPassword")}<input required type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label><label className="block text-sm font-semibold text-navy">{t("twoFactor.authOrRecoveryCode")}<input required type="text" autoComplete="one-time-code" maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-mono" dir="ltr" /></label><Button type="submit" variant="outline" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldOff size={16} />}{t("twoFactor.disable")}</Button></form>
    </div> : setup ? <form onSubmit={verify} className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-50 p-4"><QRCodeSVG value={setup.otpauthUrl} size={176} level="M" includeMargin aria-label={t("twoFactor.qrAlt")} /><p className="text-center text-sm text-slate-600">{t("twoFactor.enterSecretManually")}</p><code dir="ltr" className="select-all rounded-lg bg-white px-3 py-2 font-mono text-sm font-bold tracking-widest">{setup.secret}</code><p className="text-center text-xs text-slate-500">{t("twoFactor.secretWarning")}</p></div>
      <label className="block text-sm font-semibold text-navy">{t("twoFactor.authCode")}<input required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-center font-mono text-lg tracking-[0.3em]" dir="ltr" /></label><Button type="submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{t("twoFactor.confirmEnable")}</Button>
    </form> : <form onSubmit={begin} className="space-y-4"><p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{t("twoFactor.setupInstructions")}</p><label className="block text-sm font-semibold text-navy">{t("twoFactor.currentPassword")}<input required type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{t("twoFactor.beginSetup")}</Button></form>}
  </section>;
}
