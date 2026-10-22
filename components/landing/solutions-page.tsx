"use client";

import { useEffect, useState } from "react";
import { MarketingShell } from "./marketing-shell";
import { IndustryTabs } from "./industry-tabs";
import { isTrialDays } from "./marketing-types";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import type { LandingLanguage } from "./product-mockups";

export function SolutionsPage() {
  const { locale: language } = useDataLocale();
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const isAr = language === "ar";

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/public/settings", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { trialDays?: unknown } | null;
        if (!response.ok || !isTrialDays(payload?.trialDays)) return;
        setTrialDays(payload.trialDays);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  return (
    <MarketingShell surface="light">
      <section
        className={`solutions-page min-h-[calc(100vh-9rem)] overflow-hidden ${isAr ? "solutions-ar" : "solutions-en"}`}
        lang={language as LandingLanguage}
        dir={isAr ? "rtl" : "ltr"}
      >
        <IndustryTabs language={language as LandingLanguage} trialDays={trialDays} />
      </section>
    </MarketingShell>
  );
}
