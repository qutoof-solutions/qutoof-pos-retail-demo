"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, MessageSquareQuote, Search, ShieldCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScrollReveal } from "./scroll-reveal";
import type { LandingLanguage } from "./product-mockups";

type Pair = [string, string];

export function WhyChooseUs({ language }: { language: LandingLanguage }) {
  const t = useTranslations("landing.marketing");
  const items = t.raw("why.items") as Pair[];
  const icons = [Zap, Clock3, ShieldCheck] as const;
  return <section dir={language === "ar" ? "rtl" : "ltr"} className="landing-section px-4 py-16 sm:px-6 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><ScrollReveal><p className="landing-eyebrow">{t("why.eyebrow")}</p><h2 className="landing-section-title mt-3">{t("why.title")}</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">{t("why.text")}</p></ScrollReveal><div className="mt-8 grid gap-4 md:grid-cols-3">{items.map(([title, text], index) => { const Icon = icons[index]; return <ScrollReveal key={title} delay={index * 90}><article className="landing-feature-card lift-on-hover rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900"><span className="grid size-11 place-items-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-300/10 dark:text-teal-100"><Icon size={21} /></span><h3 className="mt-4 font-bold text-slate-900 dark:text-white">{title}</h3><p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-400">{text}</p></article></ScrollReveal>; })}</div></div></section>;
}

export function TestimonialsSection({ language }: { language: LandingLanguage }) {
  const t = useTranslations("landing.marketing");
  const testimonials = t.raw("testimonials.items") as Pair[];
  return <section id="testimonials" dir={language === "ar" ? "rtl" : "ltr"} className="landing-section px-4 py-16 sm:px-6 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><ScrollReveal><div><p className="landing-eyebrow">{t("testimonials.eyebrow")}</p><h2 className="landing-section-title mt-3">{t("testimonials.title")}</h2></div></ScrollReveal><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{testimonials.map(([quote, business], index) => <ScrollReveal key={business} delay={index * 80}><article className="landing-testimonial-card lift-on-hover relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900"><span aria-hidden="true" className="absolute -end-3 -top-5 text-7xl font-serif leading-none text-teal-300/15">“</span><MessageSquareQuote size={22} className="relative text-teal-600 dark:text-teal-200" /><p className="relative mt-4 min-h-20 text-sm leading-7 text-slate-700 dark:text-slate-200">“{quote}”</p><div className="relative mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"><CheckCircle2 size={15} className="text-teal-600 dark:text-teal-200" />{business}</div></article></ScrollReveal>)}</div></div></section>;
}

export function FaqSection({ language }: { language: LandingLanguage }) {
  const t = useTranslations("landing.marketing");
  const faqs = t.raw("faq.items") as Pair[];
  const [query, setQuery] = useState("");
  const filteredFaqs = useMemo(() => { const normalized = query.trim().toLocaleLowerCase(language === "ar" ? "ar-EG-u-nu-latn" : "en-US"); if (!normalized) return faqs; return faqs.filter(([q, a]) => `${q} ${a}`.toLocaleLowerCase(language === "ar" ? "ar-EG-u-nu-latn" : "en-US").includes(normalized)); }, [faqs, language, query]);
  return <section id="faq" dir={language === "ar" ? "rtl" : "ltr"} className="landing-section px-4 py-16 sm:px-6 sm:py-20 lg:px-10"><div className="mx-auto max-w-4xl"><ScrollReveal><p className="landing-eyebrow">{t("faq.eyebrow")}</p><h2 className="landing-section-title mt-3">{t("faq.title")}</h2><div className="relative mt-6"><Search size={17} aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" inputMode="search" aria-label={t("faq.searchLabel")} placeholder={t("faq.searchPlaceholder")} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-200 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-teal-300" /></div></ScrollReveal><div className="mt-8 space-y-3">{filteredFaqs.length ? filteredFaqs.map(([question, answer], index) => <ScrollReveal key={question} delay={index * 60}><details className="landing-faq-card group rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-lg dark:border-slate-700 dark:bg-slate-900"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white marker:hidden"><span>{question}</span><ChevronDown size={18} className="shrink-0 text-teal-600 dark:text-teal-200 transition group-open:rotate-180" /></summary><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-400">{answer}</p></details></ScrollReveal>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{t("faq.empty")}</p>}</div></div></section>;
}
