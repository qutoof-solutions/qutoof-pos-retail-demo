"use client";

import type { ReactNode } from "react";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { WhatsAppWidget } from "@/components/landing/whatsapp-widget";

function DashboardLocaleContent({ children, showWidget }: { children: ReactNode; showWidget: boolean }) {
  const { locale } = useDataLocale();
  return <div dir={locale === "ar" ? "rtl" : "ltr"} lang={locale} className="contents">
    {children}
    {showWidget && <WhatsAppWidget language={locale} />}
  </div>;
}

export function DashboardLocaleShell({ children, showWidget = false }: { children: ReactNode; showWidget?: boolean }) {
  return <DashboardLocaleContent showWidget={showWidget}>{children}</DashboardLocaleContent>;
}
