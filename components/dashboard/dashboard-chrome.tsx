"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { Button } from "@/components/ui/button";

export function DashboardBillingLink() {
  const t = useTranslations("dashboardChrome");
  return <Link href="/dashboard/billing" className="text-sm font-medium text-teal">{t("billing")}</Link>;
}

export function DashboardTenantMeta({ timezone }: { timezone: string }) {
  const t = useTranslations("dashboardChrome");
  return <p className="font-semibold text-navy">{t("appointments")} · {timezone}</p>;
}

export function DashboardLogoutButton({ dark = false }: { dark?: boolean }) {
  const t = useTranslations("dashboardChrome");
  return <form action="/api/auth/logout" method="post"><Button variant="outline" size="sm" className={dark ? "w-full border-white/20 text-white hover:bg-white/10 hover:text-white" : "text-slate-900 dark:text-slate-100"} type="submit"><LogOut size={15} />{t("logout")}</Button></form>;
}

export function DashboardStatusBadge({ status, role }: { status: string; role: string }) {
  const t = useTranslations("dashboardChrome");
  const roleKey = role as "business_admin" | "owner" | "reception" | "provider" | "doctor" | "specialist" | "storekeeper" | "nurse";
  const roleLabel = t.has(`roles.${roleKey}`) ? t(`roles.${roleKey}`) : role;
  const statusLabel = status === "grace" ? t("grace") : status === "active_trial" ? t("activeTrial") : roleLabel;
  return <span className={`rounded-full px-3 py-1.5 text-sm ${status === "grace" ? "bg-amber-100 text-amber-900" : "bg-teal/10 text-teal"}`}>{statusLabel}</span>;
}

export function DashboardGraceBanner({ canManageBilling, endsAt }: { canManageBilling: boolean; endsAt: string | number | Date | null }) {
  const t = useTranslations("dashboardChrome");
  const { locale } = useDataLocale();
  const date = endsAt ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(new Date(endsAt)) : "";
  return <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">{t("graceMessage")} {canManageBilling && <Link href="/dashboard/billing" className="mx-1 font-bold underline">{t("billing")}</Link>}{date && <span>{t("endedOn", { date })}</span>}</div>;
}

export function DashboardTrialBanner({ endsAt, daysRemaining }: { endsAt: string | number | Date | null; daysRemaining: number | null }) {
  const t = useTranslations("dashboardChrome");
  const { locale } = useDataLocale();
  const date = endsAt ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(new Date(endsAt)) : "";
  const trialMessage = daysRemaining === null ? t("activeTrial") : t("trialActive", { days: daysRemaining });
  return <div className="mb-5 rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm text-teal">{trialMessage}{date ? ` ${t("until", { date })}` : ""}. <Link href="/dashboard/billing" className="font-bold underline">{t("manageSubscription")}</Link></div>;
}
