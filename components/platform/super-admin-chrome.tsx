"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LogOut, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { DataLanguageToggle } from "@/components/operations/data-portability-ui";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import type { workerHeartbeats, workerJobRuns } from "@/lib/db/schema";

export function SuperAdminHeader({ fullName }: { fullName: string }) {
  const locale = useLocale();
  const t = useTranslations("superAdminPage");
  return <header dir={locale === "ar" ? "rtl" : "ltr"} className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-8">
    <Link href="/super-admin" className="inline-flex items-center" aria-label="Qutoof Business"><BrandLogo className="h-16 w-16 object-contain" /></Link>
    <div className="flex items-center gap-3">
      <DataLanguageToggle titleKey="interfaceLanguage" />
      <ThemeToggle />
      <span className="hidden items-center gap-1 rounded-full bg-teal/10 px-3 py-2 text-xs font-semibold text-teal sm:flex"><ShieldCheck size={15} />{t("owner")} · {fullName}</span>
      <form action="/api/auth/logout" method="post"><Button type="submit" variant="outline" size="sm" className="text-slate-900 dark:text-slate-100"><LogOut size={16} />{t("logout")}</Button></form>
    </div>
  </header>;
}

type Heartbeat = typeof workerHeartbeats.$inferSelect;
type JobRun = typeof workerJobRuns.$inferSelect;

export function SuperAdminMonitor({ heartbeat, recentRuns, seenRecently }: { heartbeat: Heartbeat | null; recentRuns: JobRun[]; seenRecently: boolean }) {
  const locale = useLocale();
  const t = useTranslations("superAdminPage.monitor");
  const dateLocale = locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const formatDate = (date: Date, withTime: boolean) => new Intl.DateTimeFormat(dateLocale, { dateStyle: withTime ? "medium" : "short", ...(withTime ? { timeStyle: "short" as const } : {}), timeZone: "Africa/Cairo" }).format(date);
  const heartbeatStatus = !heartbeat ? t("waitingFirstRun") : seenRecently ? (heartbeat.lastStatus === "succeeded" ? t("activeLastSuccess") : t("warningLastFailed")) : t("staleHeartbeat");
  return <article dir={locale === "ar" ? "rtl" : "ltr"} className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold text-navy">{t("title")}</h2><p className="mt-1 text-sm text-slate-600">{t("description")}</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${seenRecently && heartbeat?.lastStatus === "succeeded" ? "bg-teal/10 text-teal" : "bg-amber-100 text-amber-900"}`}>{heartbeatStatus}</span>
    </div>
    {heartbeat && <p className="mt-3 text-xs text-slate-500">{t("lastHeartbeat")}: {formatDate(heartbeat.lastSeenAt, true)} · <span dir="ltr">{heartbeat.lastJobName}</span></p>}
    <div className="mt-4 divide-y divide-slate-100">
      {recentRuns.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span dir="ltr" className="font-mono text-xs">{run.jobName}</span><span className={run.status === "succeeded" ? "text-teal" : "text-red-700"}>{run.status === "succeeded" ? t("succeeded") : t("failed")}{run.httpStatus ? ` · HTTP ${run.httpStatus}` : ""}</span><time className="text-xs text-slate-500">{formatDate(run.createdAt, false)}</time></div>)}
      {recentRuns.length === 0 && <p className="py-3 text-sm text-slate-500">{t("emptyRuns")}</p>}
    </div>
  </article>;
}
