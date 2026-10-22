import { BrandLogo } from "@/components/brand/brand-logo";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { PRODUCT_NAME } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getTranslations } from "next-intl/server";

export default async function RegisterPage() {
  const t = await getTranslations("register");
  return <main className="auth-page grid min-h-screen bg-white lg:grid-cols-2">
    <section className="flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between gap-4"><Link href="/" className="inline-flex items-center" aria-label={PRODUCT_NAME}><BrandLogo priority className="h-20 w-20 object-contain" /></Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold text-navy">{t("title")}</h1>
        <p className="mb-7 mt-2 text-slate-600">{t("description")}</p>
        <AuthForm mode="register" />
      </div>
    </section>
    <aside className="hidden items-center justify-center bg-gradient-to-br from-navy to-slate-800 p-12 text-white lg:flex"><div className="max-w-lg"><BrandLogo variant="dark" className="mb-8 h-28 w-28 object-contain" /><p className="text-sm font-semibold tracking-wide text-teal-bright" dir="ltr">{PRODUCT_NAME}</p><h2 className="mt-4 text-4xl leading-relaxed font-bold">{t("asideTitle")}</h2><p className="mt-5 leading-8 text-slate-300">{t("asideText")}</p></div></aside>
  </main>;
}
