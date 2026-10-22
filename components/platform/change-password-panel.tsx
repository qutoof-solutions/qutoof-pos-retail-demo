"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { KeyRound, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/components/platform/api-client";

type ChangePasswordResponse = { message: string; warnings: string[] };

export function ChangePasswordPanel() {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ChangePasswordResponse | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<ChangePasswordResponse>("/api/super-admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("password.changeError"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-6" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="mb-5 flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"><KeyRound size={20} /></span>
      <div><p className="text-sm font-semibold text-teal">{t("password.accountSecurity")}</p><h2 className="mt-1 text-xl font-bold text-navy">{t("password.changePassword")}</h2><p className="mt-2 text-sm text-slate-600">{t("password.intro")}</p></div>
    </div>

    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {result ? <div role="status" className="space-y-4 rounded-xl border border-teal/20 bg-teal/5 p-4">
      <p className="text-sm font-semibold text-teal">{result.message}</p>
      {result.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-navy underline underline-offset-4"><LogIn size={16} />{t("password.loginWithNewPassword")}</Link>
    </div> : <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold text-navy">{t("password.currentPassword")}<input required name="currentPassword" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
      <label className="block text-sm font-semibold text-navy">{t("password.newPassword")}<input required name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /><span className="mt-1 block text-xs font-normal text-slate-500">{t("password.requirements")}</span></label>
      <label className="block text-sm font-semibold text-navy">{t("password.confirmNewPassword")}<input required name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
      <div className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600"><ShieldCheck className="me-1 inline-block" size={15} />{t("password.sessionNotice")}</div>
      <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <KeyRound size={16} />}{t("password.changePassword")}</Button>
    </form>}
  </section>;
}
