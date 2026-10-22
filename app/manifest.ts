import type { MetadataRoute } from "next";
import { BRAND_ASSETS, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";
import arMessages from "@/messages/ar.json";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: PRODUCT_TAGLINE,
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#071521",
    theme_color: "#071521",
    categories: ["business", "productivity"],
    icons: [
      { src: BRAND_ASSETS.pwa.small, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND_ASSETS.pwa.large, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: arMessages.landing.nav.login, short_name: arMessages.landing.nav.login, url: "/login", icons: [{ src: BRAND_ASSETS.pwa.small, sizes: "192x192", type: "image/png" }] },
      { name: arMessages.landing.nav.getStarted, short_name: arMessages.landing.nav.getStarted, url: "/register", icons: [{ src: BRAND_ASSETS.pwa.small, sizes: "192x192", type: "image/png" }] },
    ],
  };
}
