"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LoaderCircle, Store } from "lucide-react";
import { apiRequest } from "@/components/operations/shared";
import { Button } from "@/components/ui/button";
import { InputField, Notice, SelectField } from "@/components/operations/shared";
import type { Vertical } from "@/lib/terms";
import { useTranslations } from "next-intl";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Branch = { id: string; name: string; nameAr: string; nameEn: string; isActive: boolean };
type OnboardingData = { tenant: { name: string; vertical: Vertical; logoUrl: string }; branches: Branch[]; scheduleDaysByBranch: Record<string, number[]> };
type Profile = { description: string; bookingEnabled: boolean; acceptElectronicRequest: boolean; googleReviewUrl: string; logoUrl: string; mobileWalletLabel: string; mobileWalletNumber: string; instapayLink: string; instapayQrUrl: string; paymentInstructions: string; cancellationLeadMinutes: number; maxReschedules: number; depositRequired: boolean; depositPercentBps: number; slug: string; publicUrlPath: string };
type DayRow = { weekday: number; startsAt: string; endsAt: string; isAvailable: boolean };

const verticalTypes = ["retail", "wholesale", "medical", "sports", "restaurant", "beauty", "consulting"] as const;
const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const stepsKeys = ["identity", "branch", "hours", "payment"] as const;
const initialDays = (): DayRow[] => dayKeys.map((_, weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00", isAvailable: weekday >= 0 && weekday <= 4 }));

export function OnboardingWizard() {
  const t = useTranslations("operationsRemaining");
  const { locale } = useDataLocale();
  const isEnglish = locale === "en";
  const router = useRouter();
  const [data, setData] = useState<OnboardingData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("medical");
  const [logoUrl, setLogoUrl] = useState("");
  const [branchNameAr, setBranchNameAr] = useState("");
  const [branchNameEn, setBranchNameEn] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [days, setDays] = useState<DayRow[]>(initialDays);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [onboarding, profileResult] = await Promise.all([
        apiRequest<OnboardingData>("/api/ops/onboarding"),
        apiRequest<{ profile: Profile }>("/api/ops/public-profile"),
      ]);
      setData(onboarding);
      setName(onboarding.tenant.name);
      setVertical(onboarding.tenant.vertical);
      setLogoUrl(onboarding.tenant.logoUrl);
      setProfile(profileResult.profile);
      const activeBranch = onboarding.branches.find((branch) => branch.isActive);
      const branchId = activeBranch?.id ?? "";
      setSelectedBranchId(branchId);
      if (branchId && onboarding.scheduleDaysByBranch[branchId]?.length === 7) setStep(3);
      else if (branchId) setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.loadFailed"));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const activeBranches = useMemo(() => data?.branches.filter((branch) => branch.isActive) ?? [], [data]);
  function setDay(weekday: number, patch: Partial<DayRow>) {
    setDays((current) => current.map((day) => day.weekday === weekday ? { ...day, ...patch } : day));
  }
  async function saveIdentity() {
    await apiRequest("/api/ops/onboarding", { method: "POST", body: JSON.stringify({ action: "save_identity", name, vertical, logoUrl }) });
    await load();
    setStep(1);
    setNotice(t("notice.identitySaved"));
  }
  async function createBranch() {
    const result = await apiRequest<{ branch: Branch }>("/api/ops/branches", { method: "POST", body: JSON.stringify({ nameAr: branchNameAr, nameEn: branchNameEn }) });
    setSelectedBranchId(result.branch.id);
    setBranchNameAr("");
    setBranchNameEn("");
    await load();
    setSelectedBranchId(result.branch.id);
    setStep(2);
    setNotice(t("notice.branchCreated"));
  }
  async function saveSchedule() {
    if (!selectedBranchId) throw new Error(t("error.selectBranchFirst"));
    await apiRequest("/api/ops/schedules", { method: "PUT", body: JSON.stringify({ branchId: selectedBranchId, providerId: null, rows: days.map(({ weekday, startsAt, endsAt, isAvailable }) => ({ weekday, startsAt, endsAt, isAvailable, breaks: [] })) }) });
    await load();
    setStep(3);
    setNotice(t("notice.scheduleSaved"));
  }
  async function savePayment() {
    if (!profile) throw new Error(t("error.profileNotLoaded"));
    await apiRequest("/api/ops/public-profile", { method: "PUT", body: JSON.stringify({ description: profile.description, bookingEnabled: profile.bookingEnabled, acceptElectronicRequest: profile.acceptElectronicRequest, googleReviewUrl: profile.googleReviewUrl, logoUrl, mobileWalletLabel: profile.mobileWalletLabel, mobileWalletNumber: profile.mobileWalletNumber, instapayLink: profile.instapayLink, instapayQrUrl: profile.instapayQrUrl, paymentInstructions: profile.paymentInstructions, cancellationLeadMinutes: profile.cancellationLeadMinutes, maxReschedules: profile.maxReschedules, depositRequired: profile.depositRequired, depositPercentBps: profile.depositPercentBps }) });
    setNotice(t("notice.paymentSaved"));
  }
  async function finish(skipPayment = false) {
    if (!selectedBranchId) throw new Error(t("error.createBranchFirst"));
    if (!skipPayment) await savePayment();
    await apiRequest("/api/ops/onboarding", { method: "POST", body: JSON.stringify({ action: "complete", branchId: selectedBranchId }) });
    setNotice(t("notice.onboardingComplete"));
    window.setTimeout(() => router.replace("/dashboard"), 700);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.saveStepFailed")); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 py-20 text-slate-600"><LoaderCircle className="animate-spin" /> {t("loading")}</div>;
  if (!data || !profile) return <div className="mx-auto max-w-3xl py-12">{error && <Notice>{error}</Notice>}<Button className="mt-4" onClick={() => void load()}>{t("button.retry")}</Button></div>;

  return <main className="mx-auto max-w-3xl space-y-6" dir={isEnglish ? "ltr" : "rtl"} lang={isEnglish ? "en-GB" : "ar-EG"}>
    <header className="rounded-3xl bg-navy p-6 text-white sm:p-8"><span className="inline-grid size-12 place-items-center rounded-2xl bg-white/10"><Store /></span><p className="mt-4 text-sm font-semibold text-teal-bright">{t("header.subtitle", { step: step + 1, total: stepsKeys.length })}</p><h1 className="mt-2 text-2xl font-bold">{t("header.title")}</h1><p className="mt-2 max-w-xl text-sm leading-7 text-slate-200">{t("header.description")}</p></header>
    <nav aria-label={t("nav.ariaLabel")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stepsKeys.map((key, index) => <button type="button" key={key} onClick={() => setStep(index)} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${index === step ? "border-teal bg-teal/10 text-teal" : "border-slate-200 bg-white text-slate-600"}`}><span className="ml-2 inline-grid size-6 place-items-center rounded-full bg-slate-100 text-xs">{index < step ? <Check size={14} /> : index + 1}</span>{t(`steps.${key}`)}</button>)}</nav>
    {error && <Notice>{error}</Notice>}{notice && <Notice kind="success">{notice}</Notice>}

    {step === 0 && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><div><h2 className="text-lg font-bold text-navy">{t("section.identity.title")}</h2><p className="mt-1 text-sm text-slate-600">{t("section.identity.description")}</p></div><InputField label={t("input.businessName")} value={name} onChange={setName} required /><SelectField label={t("input.vertical")} value={vertical} onChange={(value) => setVertical(value as Vertical)} options={verticalTypes.map((v) => ({ value: v, label: t(`vertical.${v}`) }))} required /><InputField label={t("input.logoUrl")} value={logoUrl} onChange={setLogoUrl} placeholder={t("placeholder.https")} /><div className="flex justify-end"><Button disabled={busy} onClick={() => void run(saveIdentity)}>{t("button.saveContinue")} <ArrowLeft size={16} /></Button></div></section>}

    {step === 1 && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><div><h2 className="text-lg font-bold text-navy">{t("section.branch.title")}</h2><p className="mt-1 text-sm text-slate-600">{t("section.branch.description")}</p></div>{activeBranches.length > 0 && <SelectField label={t("input.selectBranchExisting")} value={selectedBranchId} onChange={setSelectedBranchId} options={activeBranches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} />}{activeBranches.length === 0 && <div className="grid gap-3 sm:grid-cols-2"><InputField label={t("input.branchNameAr")} value={branchNameAr} onChange={setBranchNameAr} placeholder={t("placeholder.branchExample")} required lang="ar-EG" dir="rtl" /><InputField label={t("input.branchNameEn")} value={branchNameEn} onChange={setBranchNameEn} required lang="en-GB" dir="ltr" /></div>}<div className="flex justify-between"><Button variant="outline" onClick={() => setStep(0)}><ArrowRight size={16} /> {t("button.previous")}</Button>{activeBranches.length === 0 ? <Button disabled={busy || branchNameAr.trim().length < 2 || branchNameEn.trim().length < 2} onClick={() => void run(createBranch)}>{t("button.createAndContinue")} <ArrowLeft size={16} /></Button> : <Button disabled={!selectedBranchId} onClick={() => setStep(2)}>{t("button.continue")} <ArrowLeft size={16} /></Button>}</div></section>}

    {step === 2 && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><div><h2 className="text-lg font-bold text-navy">{t("section.hours.title")}</h2><p className="mt-1 text-sm text-slate-600">{t("section.hours.description")}</p></div>{activeBranches.length > 1 && <SelectField label={t("input.branch")} value={selectedBranchId} onChange={setSelectedBranchId} options={activeBranches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} />}{days.map((day) => <div key={day.weekday} className="grid grid-cols-[auto_1fr_1fr] items-end gap-3 rounded-xl border border-slate-100 p-3"><label className="flex min-w-20 items-center gap-2 pb-3 text-sm font-semibold text-navy"><input type="checkbox" checked={day.isAvailable} onChange={(event) => setDay(day.weekday, { isAvailable: event.target.checked })} className="size-4 accent-teal" />{t(`day.${dayKeys[day.weekday]}`)}</label><InputField label={t("input.from")} type="time" value={day.startsAt} onChange={(value) => setDay(day.weekday, { startsAt: value })} required={day.isAvailable} /><InputField label={t("input.to")} type="time" value={day.endsAt} onChange={(value) => setDay(day.weekday, { endsAt: value })} required={day.isAvailable} /></div>)}<div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}><ArrowRight size={16} /> {t("button.previous")}</Button><Button disabled={busy || !selectedBranchId} onClick={() => void run(saveSchedule)}>{t("button.saveAndContinue")} <ArrowLeft size={16} /></Button></div></section>}

    {step === 3 && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><div><h2 className="text-lg font-bold text-navy">{t("section.payment.title")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("section.payment.description")}</p></div><InputField label={t("input.walletName")} value={profile.mobileWalletLabel} onChange={(value) => setProfile((current) => current ? { ...current, mobileWalletLabel: value } : current)} placeholder={t("placeholder.walletExample")} /><InputField label={t("input.walletNumber")} value={profile.mobileWalletNumber} onChange={(value) => setProfile((current) => current ? { ...current, mobileWalletNumber: value } : current)} placeholder={t("placeholder.walletNumberExample")} /><InputField label={t("input.instapayLink")} value={profile.instapayLink} onChange={(value) => setProfile((current) => current ? { ...current, instapayLink: value } : current)} placeholder={t("placeholder.https")} /><InputField label={t("input.instapayQr")} value={profile.instapayQrUrl} onChange={(value) => setProfile((current) => current ? { ...current, instapayQrUrl: value } : current)} placeholder={t("placeholder.https")} /><label className="block text-sm font-medium text-slate-700">{t("label.paymentInstructions")}<textarea rows={3} maxLength={1000} value={profile.paymentInstructions} onChange={(event) => setProfile((current) => current ? { ...current, paymentInstructions: event.target.value } : current)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal" /></label><div className="flex flex-wrap justify-between gap-3"><Button variant="outline" onClick={() => setStep(2)}><ArrowRight size={16} /> {t("button.previous")}</Button><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(() => finish(true))}>{t("button.skipNow")}</Button><Button disabled={busy} onClick={() => void run(() => finish(false))}>{t("button.saveFinish")} <CheckCircle2 size={17} /></Button></div></div></section>}
  </main>;
}
