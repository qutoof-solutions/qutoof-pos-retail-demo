import type { MetadataRoute } from "next";
import { getMarketingSiteUrl } from "@/lib/marketing-seo";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getMarketingSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard/", "/super-admin/", "/login", "/register", "/offline", "/queue/"] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
