import { getMarketingStructuredData, type MarketingLocale, type MarketingRoute } from "@/lib/marketing-seo";

type Props = {
  route: MarketingRoute;
  locale: MarketingLocale;
};

export function MarketingJsonLd({ route, locale }: Props) {
  const structuredData = getMarketingStructuredData(route, locale);
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />;
}
