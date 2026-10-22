import type { MetadataRoute } from "next";
import { getMarketingSiteUrl } from "@/lib/marketing-seo";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getMarketingSiteUrl();
  const lastModified = new Date("2026-10-20T00:00:00.000Z");
  return [
    { url: `${siteUrl}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/solutions`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/pricing`, lastModified, changeFrequency: "weekly", priority: 0.85 },
  ];
}
