import type { Metadata } from "next";
import { PricingPage } from "@/components/landing/pricing-page";
import { MarketingJsonLd } from "@/components/seo/marketing-json-ld";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { getMarketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("pricing", await getServerLocale());
}

export default async function PricingRoute() {
  const locale = await getServerLocale();
  return <><MarketingJsonLd route="pricing" locale={locale} /><PricingPage /></>;
}
