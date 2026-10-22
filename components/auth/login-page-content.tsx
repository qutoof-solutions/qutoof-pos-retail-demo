"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { AuthForm } from "@/components/auth-form";
import { PRODUCT_NAME } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useTranslations } from "next-intl";

export function LoginPageContent() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const next = safeBillingRedirect(params.get("next"));
  return <main className="auth-page grid min-h-screen bg-white lg:grid-cols-2">
    <section className="flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center justify-between gap-4"><Link href="/" className="inline-flex items-center" aria-label={PRODUCT_NAME}><BrandLogo priority className="h-20 w-20 object-contain" /></Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold text-navy">{t("welcome")}</h1>
        <p className="mb-8 mt-2 text-slate-600">{t("subtitle")}</p>
        <AuthForm mode="login" redirectTo={next} />
      </div>
    </section>
    <aside className="hidden items-center justify-center bg-navy p-12 text-white lg:flex"><div className="max-w-lg"><BrandLogo variant="dark" className="mb-8 h-28 w-28 object-contain" /><p className="text-3xl leading-relaxed font-semibold">{t("asideTitle")}</p><p className="mt-5 leading-8 text-slate-300">{t("asideText")}</p></div></aside>
  </main>;
}

function safeBillingRedirect(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const origin = "https://qutoof.invalid";
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname !== "/dashboard/billing") return undefined;
    const addonId = target.searchParams.get("addon");
    if (!addonId || !/^[A-Za-z0-9_-]{1,64}$/.test(addonId)) return "/dashboard/billing";
    return `/dashboard/billing?addon=${encodeURIComponent(addonId)}`;
  } catch {
    return undefined;
  }
}
