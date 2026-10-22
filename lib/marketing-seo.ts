import type { Metadata } from "next";
import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";
import { BRAND_ASSETS, PRODUCT_NAME } from "@/lib/brand";

export type MarketingLocale = "ar" | "en";
export type MarketingRoute = "home" | "solutions" | "pricing";

const DEFAULT_SITE_URL = "https://qutoof-crm-2.pages.dev";
const OG_IMAGE_PATH = BRAND_ASSETS.og;
const BUSINESS_LOGO_PATH = BRAND_ASSETS.logo.light;

const routePaths: Record<MarketingRoute, string> = {
  home: "/",
  solutions: "/solutions",
  pricing: "/pricing",
};

export function getMarketingSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  return DEFAULT_SITE_URL;
}

export function getMarketingUrl(route: MarketingRoute) {
  return `${getMarketingSiteUrl()}${routePaths[route]}`;
}

function getSeoCopy(route: MarketingRoute, locale: MarketingLocale) {
  const messages = locale === "ar" ? arMessages : enMessages;
  return messages.seo[route];
}

export function getMarketingMetadata(route: MarketingRoute, locale: MarketingLocale): Metadata {
  const copy = getSeoCopy(route, locale);
  const url = getMarketingUrl(route);
  const imageUrl = `${getMarketingSiteUrl()}${OG_IMAGE_PATH}`;
  const verification = process.env.GOOGLE_SITE_VERIFICATION?.trim();

  return {
    metadataBase: new URL(getMarketingSiteUrl()),
    title: copy.title,
    description: copy.description,
    keywords: copy.keywords,
    category: "business",
    alternates: { canonical: url },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: {
      type: "website",
      title: copy.title,
      description: copy.description,
      url,
      siteName: PRODUCT_NAME,
      locale: locale === "ar" ? "ar_EG" : "en_US",
      images: [{ url: imageUrl, width: 1200, height: 630, type: "image/png", alt: "Qutoof Business logo and brand name" }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: [{ url: imageUrl, alt: "Qutoof Business logo and brand name" }],
    },
    ...(verification ? { verification: { google: verification } } : {}),
  };
}

export function getMarketingStructuredData(route: MarketingRoute, locale: MarketingLocale) {
  const copy = getSeoCopy(route, locale);
  const seo = locale === "ar" ? arMessages.seo : enMessages.seo;
  const siteUrl = getMarketingSiteUrl();
  const url = getMarketingUrl(route);
  const language = locale === "ar" ? "ar-EG" : "en-US";
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: PRODUCT_NAME,
      url: siteUrl,
      logo: `${siteUrl}${BUSINESS_LOGO_PATH}`,
      description: locale === "ar" ? arMessages.seo.publisherDescription : enMessages.seo.publisherDescription,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: PRODUCT_NAME,
      url: siteUrl,
      publisher: { "@id": `${siteUrl}/#organization` },
      inLanguage: language,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: PRODUCT_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: siteUrl,
      description: locale === "ar" ? arMessages.seo.softwareDescription : enMessages.seo.softwareDescription,
      publisher: { "@id": `${siteUrl}/#organization` },
      featureList: seo.softwareFeatures,
    },
    {
      "@type": route === "solutions" ? "CollectionPage" : "WebPage",
      "@id": `${url}#webpage`,
      name: copy.title,
      url,
      description: copy.description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#software` },
      inLanguage: language,
    },
  ];

  if (route === "solutions") {
    graph.push({
      "@type": "ItemList",
      "@id": `${url}#industries`,
      name: seo.industriesListName,
      itemListElement: seo.industriesList
        .map((name, index) => ({ "@type": "ListItem", position: index + 1, name })),
    });
  }

  if (route === "home") {
    const faqItems = (locale === "ar" ? arMessages.landing.marketing.faq.items : enMessages.landing.marketing.faq.items) as [string, string][];
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faqItems.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
