"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Circle, CircleDollarSign, Clock3, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureRequestBox } from "@/components/platform/feature-request-box";
import { useTranslations } from "@/lib/i18n/use-translations";

export type DashboardOverviewProps = {
  fullName: string;
  tenantName: string;
  customerTerm: string;
  cards: Array<{ labelKey: string; value: string; kind: "appointment" | "customer" | "shift" | "total"; href: string }>;
  setupSteps: Array<{ titleKey: string; done: boolean; href: string }>;
  setupDone: number;
  paymentReady: boolean;
  landingHref: string;
  canManageSetup: boolean;
  canOpenCustomers: boolean;
  canOpenQueue: boolean;
};

const icons = { appointment: CalendarDays, customer: UsersRound, shift: Clock3, total: CircleDollarSign } as const;

export function DashboardOverview(props: DashboardOverviewProps) {
  const { isEnglish: en, direction, t } = useTranslations();
  const Arrow = en ? ArrowRight : ArrowLeft;

  return (
    <section className="space-y-6" dir={direction}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">{t("dashboard.greeting")}{en ? ", " : "، "}{props.fullName}</h1>
          <p className="mt-2 text-sm text-slate-600">{t("dashboard.overview")} {props.tenantName} · {t("dashboard.workspacePrivate")}</p>
        </div>
        <Button asChild>
          <Link href={props.landingHref}>
            {props.landingHref.includes("inventory") ? t("dashboard.openInventory") : t("dashboard.openCalendar")} <CalendarDays size={18} />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {props.cards.map(({ labelKey, value, kind, href }) => {
          const Icon = icons[kind];
          return <Link href={href} key={href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"><span className="inline-grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><Icon size={20} /></span><p className="mt-4 text-sm text-muted">{t(labelKey)}</p><p className="mt-1 text-2xl font-bold text-navy">{value}</p></Link>;
        })}
      </div>

      {props.canManageSetup && <article className="rounded-2xl border border-teal/20 bg-white p-6 dark:border-teal/40 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-navy">{t("dashboard.setup")}</h2>
            <p className="mt-1 text-sm text-slate-600">{props.setupDone === props.setupSteps.length ? t("dashboard.setupDone") : t("dashboard.setupProgress", { done: props.setupDone, total: props.setupSteps.length })}</p>
          </div>
          <Link href="/dashboard/public-booking" className="flex items-center gap-2 text-sm font-semibold text-teal">{t("dashboard.bookingPayments")} <Arrow size={16} /></Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {props.setupSteps.map((step) => <Link key={step.href} href={step.href} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm hover:border-teal/40 dark:border-slate-700"><span className={step.done ? "text-teal" : "text-slate-300"}>{step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}</span>{t(step.titleKey)}</Link>)}
        </div>
        <p className="mt-3 text-xs leading-6 text-slate-500">{t("common.optional")} {t("dashboard.manualPaymentStatus")} {props.paymentReady ? t("dashboard.paymentChannelReady") : t("dashboard.paymentChannelMissing")}.</p>
      </article>}

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-bold text-navy">{t("dashboard.todayOperations")}</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">{t("dashboard.todayHelp")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {props.canOpenCustomers && <Button asChild variant="outline"><Link href="/dashboard/customers">{t("dashboard.customerFiles")}</Link></Button>}
            {props.canOpenQueue && <Button asChild variant="outline"><Link href="/dashboard/queue">{t("dashboard.manageQueue")}</Link></Button>}
          </div>
        </article>
        <article className="rounded-2xl border border-teal/20 bg-teal/5 p-6"><h2 className="font-bold text-navy">{t("dashboard.securityNotice")}</h2><p className="mt-2 text-sm leading-7 text-slate-600">{t("dashboard.securityHelp")}</p></article>
      </div>

      {props.canManageSetup && <FeatureRequestBox />}
    </section>
  );
}
