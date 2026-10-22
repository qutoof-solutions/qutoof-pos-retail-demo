import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, localeDirection, resolveAppLocale } from "@/lib/i18n/locale-cookie";
import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export async function GET() {
  const cookieStore = await cookies();
  const locale = resolveAppLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const copy = (locale === "ar" ? arMessages : enMessages).common;
  const direction = localeDirection(locale);
  const title = escapeHtml(copy.notFoundTitle);
  const description = escapeHtml(copy.notFoundDescription);
  const backToHome = escapeHtml(copy.backToHome);
  const html = `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:36px 28px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;text-align:center;box-shadow:0 12px 36px #0f172a0d}.code{margin:0;color:#0d9488;font-size:14px;font-weight:700}h1{margin:12px 0;color:#102a43;font-size:28px}p{color:#475569;line-height:1.8}a{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:12px;background:#0d9488;color:#fff;text-decoration:none;font-weight:700}</style></head><body><main class="card"><p class="code">404</p><h1>${title}</h1><p>${description}</p><a href="/">${backToHome}</a></main></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
}
