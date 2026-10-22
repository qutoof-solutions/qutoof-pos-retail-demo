"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes, CheckCircle2, Coffee, Dumbbell, Store, Stethoscope, Wrench } from "lucide-react";
import { IndustryMockup, type IndustryKind, type LandingLanguage } from "./product-mockups";
import { trialCtaLabel } from "./marketing-types";
import { ScrollReveal } from "./scroll-reveal";

type IndustryItem = {
  id: IndustryKind;
  title: string;
  english: string;
  lead: string;
  activities: string[];
  features: string[];
};

const industryIcons: Record<IndustryKind, typeof Store> = { retail: Store, wholesale: Boxes, showroom: Wrench, restaurant: Coffee, clinic: Stethoscope, services: Dumbbell, gym: Dumbbell };

type Props = { language: LandingLanguage; trialDays: number | null };

export function IndustryTabs<T extends Props>({ language, trialDays }: T) {
  const [active, setActive] = useState<IndustryKind>("retail");
  const t = useTranslations("landing.industries");
  const items = (t.raw("items") as IndustryItem[]).map((item) => ({ ...item, icon: industryIcons[item.id] }));
  const selected = items.find((item) => item.id === active) ?? items[0];
  const isAr = language === "ar";
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const activeTab = tabRefs.current.find((tab) => tab?.id === `industry-tab-${active}`);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active]);

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (index + (isAr ? -1 : 1) + items.length) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + (isAr ? 1 : -1) + items.length) % items.length;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    setActive(nextItem.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return <section id="industries" className="landing-section px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
    <div className="mx-auto max-w-7xl">
      <ScrollReveal><div className="max-w-3xl"><p className="landing-eyebrow text-teal-700 dark:text-teal-200">{t("eyebrow")}</p><h2 className="landing-section-title mt-3 text-slate-900 dark:text-white">{t("title")}</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">{t("description")}</p></div></ScrollReveal>
      <div className="marketing-tablist mt-8 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-3 sm:flex-wrap sm:overflow-visible" role="tablist" aria-orientation="horizontal" aria-label={t("tabsLabel")} dir={isAr ? "rtl" : "ltr"}>
        {items.map(({ id, icon: Icon, title, english }, index) => { const selectedTab = active === id; return <button key={id} ref={(node) => { tabRefs.current[index] = node; }} tabIndex={selectedTab ? 0 : -1} onKeyDown={(event) => moveTabFocus(event, index)} id={`industry-tab-${id}`} type="button" role="tab" aria-selected={selectedTab} aria-controls="industry-panel" onClick={() => setActive(id)} className={`snap-center inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 ${selectedTab ? "border-teal-700/40 bg-teal-100 text-teal-800 shadow-[0_0_26px_-12px_rgba(13,148,136,.55)] dark:border-teal-200/50 dark:bg-teal-300/15 dark:text-teal-100 dark:shadow-[0_0_26px_-12px_rgba(45,212,191,.8)]" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/[0.07]"}`}><Icon size={16} /><span>{isAr ? title : english}</span></button>; })}
      </div>
      <ScrollReveal><div id="industry-panel" role="tabpanel" aria-labelledby={`industry-tab-${active}`} className="landing-industry-panel lift-on-hover mt-5 grid items-start gap-9 rounded-[1.8rem] border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl sm:p-7 lg:grid-cols-[.9fr_1.1fr] lg:gap-12 lg:p-9">
        <div className="py-2"><p className="text-xs font-bold uppercase tracking-[.16em] text-teal-200">{selected.english}</p><h3 className="mt-3 text-2xl font-bold text-white sm:text-3xl">{selected.title}</h3><p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">{selected.lead}</p><div className="mt-6 grid gap-2 sm:grid-cols-2">{selected.activities.map((activity) => <span key={activity} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-slate-200">{activity}</span>)}</div><h4 className="mt-7 text-sm font-bold text-teal-100">{t("keyFeatures")}</h4><ul className="mt-3 space-y-3">{selected.features.map((feature) => <li key={feature} className="flex items-start gap-3 text-sm text-slate-200"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-teal-300/15 text-teal-100"><CheckCircle2 size={13} /></span><span>{feature}</span></li>)}</ul><Link href="/register" className="mt-7 inline-flex items-center gap-2 text-xs font-semibold text-slate-300 transition hover:text-white">{trialCtaLabel(language, trialDays)}<Arrow size={14} /></Link></div>
        <div className="min-w-0"><IndustryMockup kind={selected.id} language={language} /></div>
      </div></ScrollReveal>
    </div>
  </section>;
}
