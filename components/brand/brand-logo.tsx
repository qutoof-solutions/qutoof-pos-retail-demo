"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BRAND_ASSETS } from "@/lib/brand";

type BrandLogoProps = { variant?: "dark" | "light" | "auto"; className?: string; priority?: boolean };

type ThemeChangeEvent = CustomEvent<{ dark: boolean }>;

export function BrandLogo({ variant = "auto", className = "", priority = false }: BrandLogoProps) {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    if (variant !== "auto") return;
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const onThemeChange = (event: Event) => setIsDark((event as ThemeChangeEvent).detail.dark);
    window.addEventListener("qutoof-theme-change", onThemeChange);
    return () => {
      window.removeEventListener("qutoof-theme-change", onThemeChange);
    };
  }, [variant]);

  const resolvedVariant = variant === "auto" ? (isDark ? "dark" : "light") : variant;
  const source = resolvedVariant === "dark" ? BRAND_ASSETS.logo.dark : BRAND_ASSETS.logo.light;
  return <Image src={source} alt="Qutoof Business" width={1920} height={1920} priority={priority} unoptimized className={`brand-logo ${className}`} />;
}
