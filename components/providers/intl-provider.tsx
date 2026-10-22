"use client";

import { NextIntlClientProvider } from "next-intl";
import { useEffect } from "react";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";

const messages = { ar: arMessages, en: enMessages } as const;

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useDataLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Africa/Cairo">{children}</NextIntlClientProvider>;
}
