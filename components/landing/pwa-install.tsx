"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Laptop, Smartphone, X } from "lucide-react";
import type { LandingLanguage } from "./product-mockups";

type InstallChoiceEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallChoiceEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(isStandalone);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallChoiceEvent);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); setShowInstructions(false); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (installed) return;
    if (!promptEvent) { setShowInstructions(true); return; }
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setShowInstructions(true);
    } finally {
      setPromptEvent(null);
    }
  }, [installed, promptEvent]);

  return { installed, canPrompt: Boolean(promptEvent), showInstructions, setShowInstructions, install };
}

export function InstallButton({ language, installed, onClick, variant = "compact" }: { language: LandingLanguage; installed: boolean; onClick: () => void; variant?: "compact" | "hero" }) {
  const isAr = language === "ar";
  const label = installed ? (isAr ? "التطبيق مثبّت" : "App installed") : variant === "hero" ? (isAr ? "تثبيت البرنامج على الكمبيوتر / الموبايل" : "Install desktop / mobile app") : (isAr ? "تثبيت التطبيق" : "Install app");
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={installed} className={`inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.055] font-semibold text-white transition hover:border-teal-200/40 hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 disabled:cursor-default disabled:opacity-60 ${variant === "hero" ? "w-full px-5 py-3.5 text-xs sm:w-auto sm:min-w-52 sm:text-sm" : "px-3 py-2.5 text-xs"}`}>
    {variant === "hero" ? <><Laptop size={16} /><Smartphone size={15} className="-ms-1" /></> : <Download size={15} />}
    <span className={variant === "compact" ? "hidden sm:inline" : undefined}>{label}</span>
  </button>;
}

export function InstallInstructions({ language, onClose }: { language: LandingLanguage; onClose: () => void }) {
  const isAr = language === "ar";
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" className="w-full max-w-md rounded-[1.6rem] border border-white/15 bg-[#0b1926] p-6 text-white shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><span className="grid size-11 place-items-center rounded-2xl bg-teal-300/15 text-teal-100"><Download size={20} /></span><button type="button" onClick={onClose} aria-label={isAr ? "إغلاق" : "Close"} className="grid size-9 place-items-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white"><X size={18} /></button></div>
      <h2 id="pwa-install-title" className="mt-5 text-xl font-bold">{isAr ? "ثبّت Qutoof Business على جهازك" : "Install Qutoof Business on your device"}</h2>
      <p className="mt-3 text-sm leading-7 text-slate-300">{isAr ? "إضافة التطبيق إلى الشاشة الرئيسية تفتحه في نافذة مستقلة وتسهّل الوصول إليه." : "Add the app to your home screen for a focused, standalone window and quicker access."}</p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-7 text-slate-200">
        {isIOS ? <><strong className="block text-teal-100">{isAr ? "على iPhone أو iPad" : "On iPhone or iPad"}</strong><span>{isAr ? "اضغط زر المشاركة في Safari، ثم اختر «إضافة إلى الشاشة الرئيسية»." : "Tap Share in Safari, then choose “Add to Home Screen.”"}</span></> : <><strong className="block text-teal-100">{isAr ? "على الكمبيوتر أو Android" : "On desktop or Android"}</strong><span>{isAr ? "افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»." : "Open your browser menu and choose “Install app” or “Add to Home screen.”"}</span></>}
      </div>
      <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-teal-300 px-4 py-3 text-sm font-bold text-[#06252b] transition hover:bg-teal-200">{isAr ? "حسنًا" : "Got it"}</button>
    </section>
  </div>;
}
