import type { Metadata } from "next";
import { SolutionsPage } from "@/components/landing/solutions-page";
import { MarketingJsonLd } from "@/components/seo/marketing-json-ld";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { getMarketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("solutions", await getServerLocale());
}

export default async function SolutionsRoute() {
  const locale = await getServerLocale();
  return <><MarketingJsonLd route="solutions" locale={locale} /><SolutionsPage /></>;
}
