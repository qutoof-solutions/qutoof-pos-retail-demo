"use client";

import { useDataLocale } from "@/components/operations/data-portability-ui";
import { MarketingShell } from "./marketing-shell";
import { PricingSection } from "./pricing-section";
import { usePublicPricing } from "./use-public-pricing";

export function PricingPage() {
  const { locale: language } = useDataLocale();
  const pricing = usePublicPricing();

  return (
    <MarketingShell surface="light">
      <div className="pricing-page">
        <PricingSection
          language={language}
          plans={pricing.plans}
          addOns={pricing.addOns}
          loading={pricing.status === "loading"}
          failed={pricing.status === "error"}
          trialDays={pricing.trialDays}
          onRetry={pricing.retry}
        />
      </div>
    </MarketingShell>
  );
}
