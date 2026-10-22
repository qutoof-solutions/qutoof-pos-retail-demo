"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { LandingLanguage } from "./product-mockups";
import { buildWhatsAppWebUrl } from "@/lib/whatsapp/web";

const DEFAULT_PUBLIC_SALES_WHATSAPP = "201002785919";

type WhatsAppWidgetProps = {
  language: LandingLanguage;
  hideOnScroll?: boolean;
};

export function WhatsAppWidget({ language, hideOnScroll = true }: WhatsAppWidgetProps) {
  const t = useTranslations("landing.whatsappSupport");
  const [hiddenOnScroll, setHiddenOnScroll] = useState(false);
  const isAr = language === "ar";

  useEffect(() => {
    if (!hideOnScroll) return;
    let previousY = window.scrollY;
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY > previousY + 8 && currentY > 96) setHiddenOnScroll(true);
      if (currentY < previousY - 8 || currentY <= 24) setHiddenOnScroll(false);
      previousY = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hideOnScroll]);

  const phone = process.env.NEXT_PUBLIC_SALES_WHATSAPP || DEFAULT_PUBLIC_SALES_WHATSAPP;
  const href = buildWhatsAppWebUrl(phone, t("message"));
  if (!href) return null;

  const hidden = hideOnScroll && hiddenOnScroll;
  const label = t("label");

  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} aria-hidden={hidden} tabIndex={hidden ? -1 : 0} className={`fixed bottom-4 z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-emerald-200/25 bg-[#0e2c29]/95 px-3.5 py-3 text-[11px] font-bold text-emerald-50 shadow-[0_14px_45px_-14px_rgba(0,0,0,.85)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-emerald-200/60 hover:bg-[#123d37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 sm:bottom-8 sm:px-4 sm:text-xs ${hidden ? "pointer-events-none translate-y-24 opacity-0" : "opacity-100"} ${isAr ? "left-4 sm:left-7" : "right-4 sm:right-7"}`}>
    <MessageCircle size={18} className="text-emerald-300" />
    <span>{t("button")}</span>
  </a>;
}
