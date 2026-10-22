import { loadPublicTenant } from "@/lib/server/public-booking";
import { BRAND_ASSETS, PRODUCT_NAME } from "@/lib/brand";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, route: RouteContext): Promise<Response> {
  const { slug } = await route.params;
  const context = await loadPublicTenant(slug);
  if (!context) return Response.json({ error: "صفحة الحجز غير متاحة" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const startUrl = `/${encodeURIComponent(context.tenant.slug)}/`;
  const manifest = {
    id: startUrl,
    name: `${context.tenant.name} | ${PRODUCT_NAME}`,
    short_name: context.tenant.name.slice(0, 12),
    description: context.profile.description || "احجز موعدك مع المنشأة بسهولة وأمان",
    lang: "ar",
    dir: "rtl",
    start_url: startUrl,
    scope: `/${encodeURIComponent(context.tenant.slug)}/`,
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#0F172A",
    icons: [
      { src: BRAND_ASSETS.pwa.small, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND_ASSETS.pwa.large, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
