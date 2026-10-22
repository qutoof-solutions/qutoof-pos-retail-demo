"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

export const THEME_STORAGE_KEY = "qutoof-theme";

type ThemeToggleProps = { defaultTheme?: "dark" | "light" };

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.backgroundColor = dark ? "#0F172A" : "#F8FAFC";
  window.dispatchEvent(new CustomEvent("qutoof-theme-change", { detail: { dark } }));
}

function readSavedTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveTheme(theme: "dark" | "light") {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing or blocked storage should not break theme switching.
  }
}

export function ThemeToggle({ defaultTheme }: ThemeToggleProps) {
  const t = useTranslations("theme");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = readSavedTheme();
    const prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const enabled = saved ? saved === "dark" : defaultTheme ? defaultTheme === "dark" : prefersDark;
    applyTheme(enabled);
    setDark(enabled);
  }, [defaultTheme]);
  function toggle() {
    const next = !dark;
    applyTheme(next);
    saveTheme(next ? "dark" : "light");
    setDark(next);
  }
  return <button type="button" onClick={toggle} aria-label={dark ? t("enableLight") : t("enableDark")} aria-pressed={dark} className="theme-toggle inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 transition hover:-translate-y-0.5 hover:border-teal dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><span className="hidden sm:inline">{dark ? t("light") : t("dark")}</span>{dark ? <Moon size={16} /> : <Sun size={16} />}</button>;
}
