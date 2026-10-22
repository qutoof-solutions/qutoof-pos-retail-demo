"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  Cpu,
  HeartPulse,
  Layers3,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Shirt,
  ShoppingBasket,
  PartyPopper,
  Plus,
  Utensils,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { HeroMockups, type LandingLanguage } from "./product-mockups";
import { InstallButton, InstallInstructions, usePwaInstall } from "./pwa-install";
import { ScrollReveal } from "./scroll-reveal";
import { LiveUiMockups } from "./live-ui-mockups";
import { FaqSection, TestimonialsSection, WhyChooseUs } from "./marketing-sections";
import { LiveDemoButton } from "@/components/landing/live-demo-button";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { useTranslations } from "next-intl";

type SectorGroup = { title: string; items: string[] };

const sectorGroupIcons = [ShoppingBasket, Shirt, Utensils, HeartPulse, Cpu, Wrench, PartyPopper] as const;

export function LandingPage() {
  const { locale: language } = useDataLocale();
  const i18n = useTranslations("landing");
  const install = usePwaInstall();
  const [sectorsOpen, setSectorsOpen] = useState(false);
  const industries = i18n.raw("hero.industries") as string[];
  const sectorGroups = i18n.raw("hero.sectorModal.groups") as SectorGroup[];
  const t = {
    badge: i18n("hero.badge"),
    title: i18n("hero.title"),
    subtitle: i18n("hero.subtitle"),
    explore: i18n("hero.explore"),
    promise1: i18n("promises.one"),
    promise2: i18n("promises.two"),
    promise3: i18n("promises.three"),
    featuresEyebrow: i18n("features.eyebrow"),
    featuresTitle: i18n("features.title"),
    featuresText: i18n("features.text"),
    posTitle: i18n("features.posTitle"),
    posText: i18n("features.posText"),
    emrTitle: i18n("features.emrTitle"),
    emrText: i18n("features.emrText"),
    qrTitle: i18n("features.qrTitle"),
    qrText: i18n("features.qrText"),
    reportTitle: i18n("features.reportTitle"),
    reportText: i18n("features.reportText"),
    sample: i18n("features.sample"),
    report: i18n("features.report"),
    closed: i18n("features.closed"),
    cash: i18n("features.cash"),
    electronic: i18n("features.electronic"),
    net: i18n("features.net"),
    reconciled: i18n("features.reconciled"),
    mockupTitle: i18n("features.mockupTitle"),
    sampleId: i18n("features.sampleId"),
    currency: i18n("features.currency"),
    reconciliation: i18n("features.reconciliation"),
    illustration: i18n("features.illustration"),
    ctaTitle: i18n("cta.title"),
    ctaText: i18n("cta.text"),
    solutionsCta: i18n("pageCtas.solutions"),
    pricingCta: i18n("pageCtas.pricing"),
  };
  const isAr = language === "ar";
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  const moreIndustries = i18n("hero.moreIndustries");

  return (
    <div className={`landing-page min-h-screen overflow-hidden bg-[#071521] pb-28 text-white sm:pb-32 ${isAr ? "landing-ar" : "landing-en"}`} lang={language} dir={isAr ? "rtl" : "ltr"}>
      <div aria-hidden="true" className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div aria-hidden="true" className="landing-glow landing-glow-top pointer-events-none absolute" />

      <section className="landing-hero relative mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 pb-14 pt-14 text-center sm:px-6 sm:pb-20 sm:pt-16 lg:px-10 lg:pb-24 lg:pt-20">
        <div className="landing-hero-content relative z-10 flex w-full max-w-4xl flex-col items-center">
          <div className="inline-flex items-center justify-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/[0.08] px-3.5 py-2 text-[11px] font-semibold text-teal-100"><Layers3 size={14} />{t.badge}</div>
          <h1 className="mt-7 max-w-4xl text-balance text-[2.35rem] leading-[1.2] font-bold tracking-tight text-white sm:mt-6 sm:text-5xl sm:leading-[1.12] lg:text-[4.15rem]">{t.title}</h1>
          <p className="mt-5 max-w-2xl text-center text-sm leading-7 text-slate-300 sm:text-base sm:leading-8 lg:text-lg">{t.subtitle}</p>
          <div className="landing-hero-industries mt-6 flex w-full max-w-4xl flex-wrap justify-center gap-2" aria-label={i18n("hero.servedIndustries")}>{industries.map((industry) => { const isMoreLink = industry === moreIndustries; const className = "inline-flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium text-slate-200 transition hover:border-teal-200/50 hover:bg-teal-200/10 hover:text-teal-100 sm:px-3.5"; return isMoreLink ? <button key={industry} type="button" className={className} aria-haspopup="dialog" aria-controls="sector-explorer-dialog" onClick={() => setSectorsOpen(true)}>{industry}<Plus size={12} aria-hidden="true" /></button> : <span key={industry} className={className}>{industry}</span>; })}</div>
          <div className="landing-hero-actions mt-8 flex w-full max-w-xl flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-teal-300 px-6 py-3 text-center text-xs font-bold text-[#06252b] shadow-[0_12px_35px_-14px_rgba(45,212,191,.8)] transition hover:-translate-y-0.5 hover:bg-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-100 sm:w-auto sm:min-w-44 sm:text-sm">{i18n("nav.getStarted")}<Arrow size={16} /></Link>
            <LiveDemoButton />
            <InstallButton language={language} installed={install.installed} onClick={install.install} variant="hero" />
          </div>
          <a href="#full-picture" className="mt-5 inline-flex items-center justify-center gap-2 text-xs font-semibold text-slate-300 transition hover:text-teal-100">{t.explore}<Arrow size={14} /></a>
          <div className="landing-hero-promises mt-8 grid w-full max-w-4xl gap-2 text-[11px] text-slate-300 sm:grid-cols-3 sm:gap-3">
            <PromiseChip text={t.promise1} /><PromiseChip text={t.promise2} /><PromiseChip text={t.promise3} />
          </div>
        </div>
        <div className="landing-hero-product relative z-10 w-full max-w-5xl"><HeroMockups language={language} /></div>
        <div className="pointer-events-none absolute -bottom-6 left-1/2 h-px w-[85%] -translate-x-1/2 bg-gradient-to-r from-transparent via-teal-200/25 to-transparent" />
      </section>

      <LiveUiMockups />

      <section id="full-picture" className="landing-section relative px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-9 lg:grid-cols-[.82fr_1.18fr] lg:gap-14">
          <div>
            <p className="landing-eyebrow">{t.featuresEyebrow}</p>
            <h2 className="landing-section-title mt-3">{t.featuresTitle}</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">{t.featuresText}</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <Feature icon={ShoppingCart} title={t.posTitle} text={t.posText} delay={0} />
              <Feature icon={CalendarDays} title={t.emrTitle} text={t.emrText} delay={70} />
              <Feature icon={PackageCheck} title={t.qrTitle} text={t.qrText} delay={140} />
              <Feature icon={ChartNoAxesCombined} title={t.reportTitle} text={t.reportText} delay={210} />
            </div>
          </div>
          <ZReportPreview language={language} labels={t} />
        </div>
      </section>

      <WhyChooseUs language={language} />
      <TestimonialsSection language={language} />
      <FaqSection language={language} />

      <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-20 lg:px-10">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-teal-100/15 bg-[radial-gradient(ellipse_at_top_left,rgba(45,212,191,.2),transparent_42%),linear-gradient(120deg,rgba(255,255,255,.075),rgba(255,255,255,.025))] px-5 py-10 text-center shadow-[0_28px_90px_-55px_rgba(45,212,191,.6)] sm:px-10 sm:py-14">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.07] text-teal-100"><Wallet size={22} /></div>
          <h2 className="mx-auto mt-5 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-4xl">{t.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-300">{t.ctaText}</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/solutions" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-teal-300 px-6 py-3 text-sm font-bold text-[#06252b] transition hover:-translate-y-0.5 hover:bg-teal-200">{t.solutionsCta}<Arrow size={16} /></Link>
            <Link href="/pricing" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-teal-200/30 bg-white/[0.06] px-6 py-3 text-sm font-bold text-teal-50 transition hover:-translate-y-0.5 hover:border-teal-100/60 hover:bg-white/[0.1]">{t.pricingCta}<Arrow size={16} /></Link>
          </div>
        </div>
      </section>

      {install.showInstructions && <InstallInstructions language={language} onClose={() => install.setShowInstructions(false)} />}
      {sectorsOpen && <SectorExplorerDialog language={language} groups={sectorGroups} title={i18n("hero.sectorModal.title")} description={i18n("hero.sectorModal.description")} closeLabel={i18n("hero.sectorModal.close")} onClose={() => setSectorsOpen(false)} />}
    </div>
  );
}

function SectorExplorerDialog({ language, groups, title, description, closeLabel, onClose }: { language: LandingLanguage; groups: SectorGroup[]; title: string; description: string; closeLabel: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const dialog = <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} id="sector-explorer-dialog" role="dialog" aria-modal="true" aria-labelledby="sector-explorer-title" tabIndex={-1} dir={language === "ar" ? "rtl" : "ltr"} className="marketing-sector-dialog flex max-h-[min(90vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white text-slate-950 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7 dark:border-slate-700"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-teal-700 dark:text-teal-300">Qutoof Business</p><h2 id="sector-explorer-title" className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p></div><button type="button" onClick={onClose} aria-label={closeLabel} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:border-teal-600 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-teal-300 dark:hover:text-teal-200"><X size={19} /></button></div>
      <div className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-7"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.map((group, index) => { const Icon = sectorGroupIcons[index] ?? ShoppingBasket; return <section key={group.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/80"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-200"><Icon size={19} /></span><h3 className="text-sm font-bold text-slate-900 dark:text-white">{group.title}</h3></div><ul className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">{group.items.map((item) => <li key={item} className="flex items-start gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-300" />{item}</li>)}</ul></section>; })}</div></div>
    </div>
  </div>;

  return createPortal(dialog, document.body);
}

function PromiseChip({ text }: { text: string }) {
  return <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><CheckCircle2 size={14} className="shrink-0 text-teal-600 dark:text-teal-200" /><span>{text}</span></span>;
}

function Feature({ icon: Icon, title, text, delay }: { icon: typeof ShoppingCart; title: string; text: string; delay: number }) {
  return <ScrollReveal delay={delay}><article className="lift-on-hover rounded-2xl border border-slate-200 bg-white p-4 shadow-lg transition hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900"><span className="grid size-9 place-items-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-300/10 dark:text-teal-100"><Icon size={17} /></span><h3 className="mt-3 text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{title}</h3><p className="mt-1.5 text-[11px] leading-6 text-slate-600 dark:text-slate-400">{text}</p></article></ScrollReveal>;
}

function ZReportPreview({ language, labels: t }: { language: LandingLanguage; labels: Record<string, string> }) {
  const isAr = language === "ar";
  return <div className="relative mx-auto w-full max-w-[650px]">
    <div className="absolute -inset-5 rounded-[2rem] bg-sky-300/10 blur-3xl" />
    <div className="landing-z-report relative rounded-[1.6rem] border border-white/15 bg-[#0b1825] p-2 shadow-[0_35px_90px_-35px_rgba(0,0,0,.85)] sm:rounded-[2rem] sm:p-3">
      <div className="flex items-center justify-between rounded-t-[1.2rem] border-b border-white/10 bg-white/[0.035] px-4 py-3"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-rose-400/80" /><span className="size-2 rounded-full bg-amber-300/80" /><span className="size-2 rounded-full bg-emerald-400/80" /></div><span className="text-[9px] text-slate-400">{t.mockupTitle}</span><span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-[9px] text-emerald-100">{t.closed}</span></div>
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_.78fr] sm:p-6" dir={isAr ? "rtl" : "ltr"}>
        <div>
          <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] text-slate-400">{t.sample}</p><h3 className="mt-1 text-sm font-bold text-white sm:text-base">{t.report}</h3></div><span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] text-slate-300">{t.sampleId}</span></div>
          <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3"><p className="text-[9px] text-slate-400">{t.net}</p><p className="mt-1 text-2xl font-bold text-white">8,420 <span className="text-xs font-medium text-slate-400">{t.currency}</span></p><div className="mt-3 flex h-12 items-end gap-1.5">{[42, 70, 52, 90, 63, 81, 55, 96, 72, 61, 85, 68].map((height, i) => <span key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-teal-500/40 to-teal-200/80" style={{ height: `${height}%` }} />)}</div></div>
          <div className="mt-3 space-y-2"><ReportRow label={t.cash} value={`5,200 ${t.currency}`} /><ReportRow label={t.electronic} value={`3,220 ${t.currency}`} /></div>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
          <div><div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-200">{t.reconciliation}</span><ShieldCheck size={15} className="text-teal-200" /></div><div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-emerald-300/10 text-emerald-200"><CheckCircle2 size={12} /></span><span className="h-1.5 flex-1 rounded-full bg-white/10"><span className="block h-full w-full rounded-full bg-teal-200/55" /></span></div>)}</div></div>
          <div className="mt-5 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.06] p-3"><p className="text-[9px] text-emerald-100">{t.reconciled}</p><p className="mt-1 text-[8px] text-slate-400">{t.illustration}</p></div>
        </div>
      </div>
      <div className="mx-auto mb-1 h-2 w-1/3 rounded-full bg-slate-700/70" />
    </div>
  </div>;
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"><span className="text-[9px] text-slate-400">{label}</span><span className="text-[9px] font-semibold text-slate-200">{value}</span></div>;
}
