"use client";

import { useTranslations as useNextTranslations } from "next-intl";
import { useDataLocale } from "@/components/operations/data-portability-ui";

export function useTranslations() {
  const { locale, setLocale } = useDataLocale();
  const t = useNextTranslations();
  return {
    locale,
    setLocale,
    isEnglish: locale === "en",
    direction: locale === "en" ? "ltr" as const : "rtl" as const,
    t: (key: string, variables: Record<string, string | number> = {}) => t(key as never, variables as never),
  };
}
