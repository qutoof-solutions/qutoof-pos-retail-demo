"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import type { BillingCycle } from "@/lib/platform/catalog";
import type { LandingLanguage } from "./product-mockups";
import { ScrollReveal } from "./scroll-reveal";
import {
  availableBillingCycles,
  billingCycleLabel,
  formatPlanLimit,
  localizedPlanDescription,
  planDiscountDisplay,
  planFeatureLabel,
  planAudience,
  preferredBillingCycle,
  resourceAddonLabel,
  trialCtaLabel,
  type PublicPlan,
  type PublicResourceAddon,
} from "./marketing-types";
import { catalogName } from "@/lib/i18n/localized-catalog";

type Props = {
  language: LandingLanguage;
  plans: PublicPlan[];
  addOns: PublicResourceAddon[];
  loading: boolean;
  failed: boolean;
  trialDays: number | null;
  onRetry: () => void;
};

export function PricingSection({ language, plans, addOns, loading, failed, trialDays, onRetry }: Props) {
  const t = useTranslations("landing.pricing");
  const isAr = language === "ar";
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  const [requestedCycle, setRequestedCycle] = useState<BillingCycle | null>(null);
  const cycles = availableBillingCycles(plans);
  const selectedCycle = requestedCycle && cycles.includes(requestedCycle) ? requestedCycle : preferredBillingCycle(cycles);
  const visiblePlans = selectedCycle ? plans.filter((plan) => plan.billingCycle === selectedCycle) : [];

  function formatAmount(priceMinor: number, currency: string) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(priceMinor / 100);
    } catch {
      return `${(priceMinor / 100).toLocaleString("en-US")} ${currency}`;
    }
  }

  return (
    <section id="pricing" className="landing-section px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="landing-eyebrow">{t("eyebrow")}</p>
          <h2 className="landing-section-title mt-3">{t("title")}</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">{t("subtitle")}</p>
        </div>

        {loading ? <div role="status" className="marketing-pricing-status mt-10 flex items-center justify-center gap-3 py-16 text-sm text-slate-300"><LoaderCircle className="animate-spin text-teal-200" size={19} />{t("loading")}</div> : failed ? <div role="alert" className="marketing-pricing-status marketing-pricing-error mx-auto mt-10 max-w-xl rounded-2xl border p-7 text-center text-sm"><p>{t("error")}</p><button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 font-semibold"><RefreshCw size={14} />{t("retry")}</button></div> : <>
          {plans.length === 0 ? <div className="marketing-pricing-status mx-auto mt-10 max-w-xl rounded-2xl border p-8 text-center text-sm text-slate-300">{t("empty")}</div> : <>
            {cycles.length > 1 && <div className="mt-7 flex flex-col items-center gap-2"><span className="text-xs font-medium text-slate-400">{t("cycleLabel")}</span><div className="inline-flex flex-wrap justify-center gap-1 rounded-full border border-white/10 bg-white/[0.045] p-1" role="group" aria-label={t("billingCycle")}>
              {cycles.map((cycle) => <button key={cycle} type="button" onClick={() => setRequestedCycle(cycle)} aria-pressed={selectedCycle === cycle} className={`rounded-full px-4 py-2.5 text-xs font-semibold transition ${selectedCycle === cycle ? "bg-teal-300 text-[#06252b] shadow-lg" : "text-slate-300 hover:text-white"}`}>{billingCycleLabel(cycle, null, language)}</button>)}
            </div></div>}
            <p className="mt-5 text-center text-xs text-slate-400">{t("actualPriceNote")}</p>
            <div className="mt-7 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5">
              {visiblePlans.map((plan, index) => {
                const name = catalogName(plan, language);
                const description = localizedPlanDescription(plan, language);
                const cycleText = billingCycleLabel(plan.billingCycle, plan.customDays, language);
                const discountDisplay = planDiscountDisplay(plan, language);
                const branchLimit = plan.limits?.branches;
                const warehouseLimit = plan.limits?.warehouses;
                const userLimit = plan.limits?.users;
                const limitRows = [
                  { label: t("branchCount"), value: formatPlanLimit(branchLimit, language, t("unspecified")) },
                  { label: t("warehouseCount"), value: formatPlanLimit(warehouseLimit, language, t("unspecified")) },
                  { label: t("userCount"), value: formatPlanLimit(userLimit, language, t("unspecified")) },
                ];
                const seenFeatureLabels = new Set<string>();
                const featureRows = Object.entries(plan.features).reduce<Array<{ label: string; value: string }>>((result, [key, enabled]) => {
                  if (enabled !== true || ["branches", "users", "warehouses"].includes(key)) return result;
                  const label = planFeatureLabel(key, language);
                  const normalizedLabel = label.trim().toLocaleLowerCase();
                  if (seenFeatureLabels.has(normalizedLabel)) return result;
                  seenFeatureLabels.add(normalizedLabel);
                  result.push({ label, value: t("available") });
                  return result;
                }, []);
                return <ScrollReveal key={`${plan.nameEn}-${plan.billingCycle}-${plan.customDays ?? ""}`} className="h-full" delay={index * 80}><article className="landing-plan-card lift-on-hover relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-lg transition duration-200 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900 sm:p-6 lg:min-h-[29rem]">
                  <div className="absolute -end-10 -top-10 size-28 rounded-full bg-teal-300/10 blur-3xl" />
                  <div className="relative"><span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-slate-300">{planAudience(plan, language)}</span><h3 className="mt-4 text-lg font-bold text-white">{name}</h3>{description && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-300">{description}</p>}</div>
                  <div className="relative mt-6"><p className="flex flex-wrap items-end gap-x-2 gap-y-1"><strong className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">{formatAmount(plan.priceMinor, plan.currency)}</strong>{discountDisplay.originalPriceMinor !== null && <del className="pb-1 text-xs text-slate-400">{formatAmount(discountDisplay.originalPriceMinor, plan.currency)}</del>}<span className="pb-1 text-xs text-slate-500 dark:text-slate-400">/ {cycleText}</span></p>{discountDisplay.label && <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-800 dark:bg-emerald-300/10 dark:text-emerald-200">{discountDisplay.label}</span>}<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("includedSupportNote")}</p></div>
                  <div className="marketing-pricing-divider my-5 h-px" />
                  <div className="relative"><h4 className="mb-3 text-xs font-bold text-slate-100">{t("limits")}</h4><dl className="grid gap-x-3 gap-y-2.5 text-[10px] sm:grid-cols-2 sm:text-[11px]">
                    {limitRows.map((row) => <div key={row.label} className="flex min-w-0 items-start gap-1.5"><dt className="min-w-0 flex-1 text-slate-400">{row.label}</dt><dd className="inline-flex max-w-[58%] items-start gap-1 text-end font-medium leading-4 text-teal-100"><CheckCircle2 size={12} className="mt-0.5 shrink-0" /><span>{row.value}</span></dd></div>)}
                  </dl><h4 className="mb-3 mt-5 text-xs font-bold text-slate-100">{t("featuresIncluded")}</h4>{featureRows.length ? <ul className="grid gap-x-3 gap-y-2.5 text-[10px] sm:grid-cols-2 sm:text-[11px]">{featureRows.map((row) => <li key={row.label} className="flex min-w-0 items-start gap-1.5"><span className="min-w-0 flex-1 text-slate-400">{row.label}</span><span className="inline-flex max-w-[58%] items-start gap-1 text-end font-medium leading-4 text-teal-100"><CheckCircle2 size={12} className="mt-0.5 shrink-0" />{row.value}</span></li>)}</ul> : <p className="text-xs text-slate-400">—</p>}</div>
                  <Link href="/register" className="marketing-primary-action relative mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{trialCtaLabel(language, trialDays) || t("startFallback")}<Arrow size={15} /></Link>
                </article></ScrollReveal>;
              })}
            </div>
          </>}

          <section className="marketing-addons-section mt-16 border-t pt-12" aria-labelledby="resource-addons-title">
            <div className="mx-auto max-w-2xl text-center"><p className="landing-eyebrow">{t("addonEyebrow")}</p><h3 id="resource-addons-title" className="mt-3 text-2xl font-bold text-white sm:text-3xl">{t("addonTitle")}</h3><p className="mt-3 text-sm leading-7 text-slate-300">{t("addonSubtitle")}</p></div>
            {addOns.length ? <div className="mt-8 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">{addOns.map((addon, index) => <ScrollReveal key={addon.id} className="h-full" delay={index * 70}><article className="landing-addon-card lift-on-hover flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900"><span className="inline-flex w-fit rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-semibold text-teal-700 dark:border-teal-200/15 dark:bg-teal-200/[0.07] dark:text-teal-100">{billingCycleLabel(addon.billingCycle, addon.customDays, language)}</span><h4 className="mt-4 text-base font-bold text-slate-900 dark:text-white">{catalogName(addon, language)}</h4>{language === "ar" && addon.nameAr !== resourceAddonLabel(addon.resourceType, language) && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{addon.nameAr}</p>}<p className="mt-4 text-xl font-bold text-slate-900 dark:text-white">{formatAmount(addon.priceMinor, addon.currency)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("perBillingCycle")}</p><Link href={`/login?next=${encodeURIComponent(`/dashboard/billing?addon=${addon.id}`)}`} className="marketing-primary-action mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{t("addonCta")}<Arrow size={15} /></Link></article></ScrollReveal>)}</div> : <p className="mx-auto mt-8 max-w-2xl rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{t("addonEmpty")}</p>}
          </section>
        </>}
      </div>
    </section>
  );
}
