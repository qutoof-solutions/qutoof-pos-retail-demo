"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BRAND_ASSETS } from "@/lib/brand";

type BrandMarkProps = { variant?: "dark" | "light" | "auto"; className?: string; priority?: boolean };
type ThemeChangeEvent = CustomEvent<{ dark: boolean }>;

export function BrandMark({ variant = "auto", className = "", priority = false }: BrandMarkProps) {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    if (variant !== "auto") return;
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const onThemeChange = (event: Event) => setIsDark((event as ThemeChangeEvent).detail.dark);
    window.addEventListener("qutoof-theme-change", onThemeChange);
    return () => window.removeEventListener("qutoof-theme-change", onThemeChange);
  }, [variant]);

  const resolvedVariant = variant === "auto" ? (isDark ? "dark" : "light") : variant;
  const source = resolvedVariant === "dark" ? BRAND_ASSETS.mark.dark : BRAND_ASSETS.mark.light;
  return <Image src={source} alt="" width={1024} height={1024} priority={priority} unoptimized className={`brand-mark object-contain ${className}`} />;
}
