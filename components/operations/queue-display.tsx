"use client";

import { PRODUCT_NAME } from "@/lib/brand";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HeartPulse, MonitorPlay, Radio } from "lucide-react";
import { apiRequest } from "@/components/operations/shared";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type QueueState = { branch: { id: string; name: string; nameAr?: string; nameEn?: string; tenantName: string }; current: { ticketNumber: number; displayLabel: string; status: string } | null; next: { ticketNumber: number; displayLabel: string } | null; waitingCount: number; updatedAt: string };

export function QueueDisplay({ branchId }: { branchId: string }) {
  const t = useTranslations("queue-gate-attendance");
  const locale = useLocale();
  const intlLocale = locale === "en" ? "en-GB" : "ar-EG";
  const [state, setState] = useState<QueueState | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    let active = true;
    const update = async () => {
      try { const result = await apiRequest<QueueState>(`/api/public/queue/${encodeURIComponent(branchId)}`); if (active) { setState(result); setError(""); } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : t("display.errors.connection")); }
    };
    void update();
    const poll = window.setInterval(() => { void update(); setNow(new Date()); }, 5000);
    return () => { active = false; window.clearInterval(poll); };
  }, [branchId, t]);
  return <main lang={locale === "en" ? "en-GB" : "ar-EG"} dir={locale === "en" ? "ltr" : "rtl"} className="flex min-h-screen flex-col bg-navy text-white"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-10"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-teal/20 text-teal-bright"><HeartPulse size={26} /></span><div><p className="text-sm text-slate-300">{state?.branch.tenantName ?? PRODUCT_NAME}</p><h1 className="text-xl font-bold sm:text-2xl">{state?.branch ? localizedBranchName(state.branch, locale) : t("display.titleFallback")}</h1></div></div><div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-slate-200"><Radio size={16} className="animate-pulse text-emerald-400" /> {t("display.liveUpdate")} · {new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }).format(now)}</div></header><section className="grid flex-1 content-center gap-8 px-5 py-10 md:grid-cols-[1.3fr_.7fr] md:px-12"><article className="flex min-h-[55vh] flex-col items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center shadow-2xl"><div className="flex items-center gap-2 text-lg text-slate-300"><MonitorPlay size={21} /> {t("display.currentTurn")}</div>{error ? <p className="mt-8 text-red-200">{error}</p> : <><strong className="mt-6 text-[clamp(6rem,26vw,18rem)] font-bold leading-none tracking-tight text-teal-bright">{state?.current ? new Intl.NumberFormat(intlLocale).format(state.current.ticketNumber) : "—"}</strong><p className="mt-6 text-2xl text-slate-200">{state?.current ? state.current.status === "serving" ? t("display.goToProvider") : t("display.called") : t("display.willShow")}</p></>}</article><aside className="flex flex-col gap-5"><article className="rounded-[2rem] border border-white/10 bg-white/5 p-7 text-center"><p className="text-lg text-slate-300">{t("display.nextTurn")}</p><strong className="mt-3 block text-7xl font-bold text-white">{state?.next ? new Intl.NumberFormat(intlLocale).format(state.next.ticketNumber) : "—"}</strong></article><article className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-teal/30 to-sky-500/20 p-7 text-center"><p className="text-lg text-slate-200">{t("display.waitingCount")}</p><strong className="mt-3 block text-6xl font-bold">{new Intl.NumberFormat(intlLocale).format(state?.waitingCount ?? 0)}</strong></article><p className="text-center text-sm leading-7 text-slate-400">{t("display.notice")}</p></aside></section><footer className="border-t border-white/10 px-6 py-4 text-center text-sm text-slate-400">{PRODUCT_NAME} · {t("display.footer")}</footer></main>;
}
