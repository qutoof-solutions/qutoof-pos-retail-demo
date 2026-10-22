"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Vertical } from "@/lib/terms";
import { useTranslations } from "next-intl";

type Mode = "login" | "register";
type Stage = "credentials" | "twoFactor" | "recovery";

type AuthResult = { error?: string; message?: string; requiresTwoFactor?: boolean; user?: { role?: string } };

export function AuthForm({ mode, redirectTo }: { mode: Mode; redirectTo?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stage, setStage] = useState<Stage>("credentials");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [vertical, setVertical] = useState<Vertical>("medical");
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let endpoint = `/api/auth/${mode}`;
      let payload: Record<string, FormDataEntryValue | Vertical> = isRegister ? { ...values, vertical } : values;
      if (stage === "twoFactor") {
        endpoint = "/api/auth/verify-2fa";
        payload = { code: values.code ?? "" };
      } else if (stage === "recovery") {
        endpoint = "/api/auth/recover";
        payload = { email: values.email ?? "", recoveryCode: values.recoveryCode ?? "", newPassword: values.newPassword ?? "", confirmPassword: values.confirmPassword ?? "" };
      }

      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as AuthResult;
      if (!response.ok) throw new Error(result.error ?? t("operationFailed"));

      if (stage === "recovery") {
        setStage("credentials");
        setNotice(result.message ?? t("resetSuccess"));
        return;
      }
      if (result.requiresTwoFactor) {
        setStage("twoFactor");
        setNotice(t("twoFactorNotice"));
        return;
      }
      router.push(result.user?.role === "super_admin" ? "/super-admin" : redirectTo ?? "/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  function openRecovery(button: HTMLButtonElement) {
    const email = button.form?.elements.namedItem("email");
    if (email instanceof HTMLInputElement) setRecoveryEmail(email.value);
    setStage("recovery"); setError(""); setNotice("");
  }

  return <form onSubmit={submit} className="space-y-4">
    {stage === "twoFactor" ? <>
      <div className="rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm leading-6 text-teal"><ShieldCheck className="me-1 inline" size={16} />{t("twoFactorNotice")}</div>
      <Field name="code" label={t("twoFactorCode")} type="text" placeholder={t("codePlaceholder")} required minLength={6} maxLength={32} autoComplete="one-time-code" inputMode="numeric" />
      <button type="button" onClick={() => { setStage("credentials"); setError(""); setNotice(""); }} className="text-sm font-semibold text-teal hover:underline">{t("backToLogin")}</button>
    </> : stage === "recovery" ? <>
      <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{t("recoveryNotice")}</p>
      <Field name="email" label={t("email")} type="email" placeholder="name@example.com" required autoComplete="email" defaultValue={recoveryEmail} />
      <Field name="recoveryCode" label={t("recoveryCode")} type="text" placeholder="XXXX-XXXX-XXXX-XXXX" required minLength={12} maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      <Field name="newPassword" label={t("newPassword")} type="password" placeholder={t("passwordMin")} required minLength={12} maxLength={128} autoComplete="new-password" />
      <Field name="confirmPassword" label={t("confirmPassword")} type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
      <p className="text-xs text-slate-500">{t("passwordHint")}</p>
      <button type="button" onClick={() => { setStage("credentials"); setError(""); setNotice(""); }} className="text-sm font-semibold text-teal hover:underline">{t("backToLogin")}</button>
    </> : <>
      {isRegister && <>
        <Field name="businessName" label={t("businessName")} placeholder={t("businessPlaceholder")} required minLength={2} maxLength={120} />
        <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{t("vertical")}</span><select value={vertical} onChange={(event) => setVertical(event.target.value as Vertical)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-teal focus:ring-2 focus:ring-teal/15"><option value="retail">{t("retail")}</option><option value="wholesale">{t("wholesale")}</option><option value="medical">{t("medical")}</option><option value="sports">{t("sports")}</option><option value="restaurant">{t("restaurant")}</option><option value="beauty">{t("beauty")}</option><option value="consulting">{t("consulting")}</option></select></label>
        <Field name="fullName" label={t("managerName")} placeholder={t("fullName")} required minLength={2} maxLength={120} />
      </>}
      <Field name="email" label={t("email")} type="email" placeholder="name@example.com" required autoComplete="email" />
      <Field name="password" label={t("newPassword")} type="password" placeholder={isRegister ? t("passwordMin") : t("loginPassword")} required minLength={isRegister ? 12 : 1} maxLength={128} autoComplete={isRegister ? "new-password" : "current-password"} />
      {isRegister && <p className="text-xs text-slate-500">{t("passwordHint")}</p>}
      {!isRegister && <button type="button" onClick={(event) => openRecovery(event.currentTarget)} className="text-sm font-semibold text-teal hover:underline">{t("recover")}</button>}
    </>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <Button className="w-full" size="lg" disabled={busy} type="submit">{busy && <LoaderCircle className="animate-spin" size={18} />}{stage === "twoFactor" ? t("verifyAndLogin") : stage === "recovery" ? t("reset") : isRegister ? t("createWorkspace") : t("login")}<ArrowLeft size={17} /></Button>
    {stage === "credentials" && <p className="pt-2 text-center text-sm text-slate-600">{isRegister ? t("hasAccount") : t("noAccount")}<Link className="font-semibold text-teal hover:underline" href={isRegister ? "/login" : "/register"}>{isRegister ? t("login") : t("createBusiness")}</Link></p>}
  </form>;
}

function Field(props: { name: string; label: string; type?: string; placeholder?: string; required?: boolean; minLength?: number; maxLength?: number; autoComplete?: string; autoCapitalize?: string; spellCheck?: boolean; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; defaultValue?: string }) {
  const { name, label, type = "text", ...inputProps } = props;
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}</span><input name={name} type={type} {...inputProps} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/15" /></label>;
}
