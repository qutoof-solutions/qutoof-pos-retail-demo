"use client";

import { useState } from "react";
import { Eye, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export function LiveDemoButton() {
  const t = useTranslations("landing.liveDemo");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function startDemo() {
    if (state === "loading") return;
    setState("loading");
    setErrorCode(null);
    try {
      const response = await fetch("/api/public/live-demo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || !("redirectTo" in payload) || typeof payload.redirectTo !== "string" || !payload.redirectTo.startsWith("/dashboard/")) {
        const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "unavailable";
        setErrorCode(code === "rate_limited" ? "rateLimited" : "unavailable");
        setState("error");
        return;
      }
      window.location.assign(payload.redirectTo);
    } catch {
      setErrorCode("unavailable");
      setState("error");
    }
  }

  return <div className="flex flex-col items-center gap-2">
    <button type="button" onClick={() => void startDemo()} disabled={state === "loading"} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-teal-100/30 bg-white/[0.06] px-5 py-3 text-center text-xs font-bold text-white transition hover:-translate-y-0.5 hover:border-teal-100/60 hover:bg-teal-100/[0.12] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-100 sm:text-sm">
      {state === "loading" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      {state === "loading" ? t("starting") : t("button")}
    </button>
    <p className="max-w-48 text-center text-[10px] leading-4 text-slate-400">{t("notice")}</p>
    {state === "error" && <p role="status" aria-live="polite" className="max-w-xs text-center text-xs leading-5 text-amber-100">{t(errorCode ?? "unavailable")}</p>}
  </div>;
}
