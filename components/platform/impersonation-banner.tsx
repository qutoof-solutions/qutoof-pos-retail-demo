"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/components/platform/api-client";

export function ImpersonationBanner({ tenantName }: { tenantName: string }) {
  const t = useTranslations("platformAdmin");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function stop() {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ redirectTo: string }>("/api/super-admin/impersonation/stop", { method: "POST" });
      router.replace(result.redirectTo);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("impersonation.stopError")); }
    finally { setBusy(false); }
  }
  return <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-md"><span className="flex items-center gap-2"><ShieldAlert size={18} />{t("impersonation.bannerPrefix")} «{tenantName}» {t("impersonation.bannerSuffix")}</span><span className="flex items-center gap-3">{error && <span role="alert" className="text-xs">{error}</span>}<Button variant="outline" size="sm" onClick={() => void stop()} disabled={busy} className="border-slate-900/30 bg-white text-slate-950 hover:bg-amber-50">{busy && <LoaderCircle className="animate-spin" size={15} />}{t("impersonation.stop")}</Button></span></div>;
}
