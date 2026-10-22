import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { MarketingShell } from "@/components/landing/marketing-shell";
import { MarketingJsonLd } from "@/components/seo/marketing-json-ld";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { getMarketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("home", await getServerLocale());
}

export default async function HomePage() {
  const locale = await getServerLocale();
  return (
    <MarketingShell surface="light">
      <MarketingJsonLd route="home" locale={locale} />
      <LandingPage />
    </MarketingShell>
  );
}
