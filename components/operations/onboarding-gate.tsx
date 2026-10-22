"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export function OnboardingGate({ required, children }: { required: boolean; children: React.ReactNode }) {
  const t = useTranslations("operationsRemaining");
  const pathname = usePathname();
  const router = useRouter();
  const isOnboardingPage = pathname === "/dashboard/onboarding";
  useEffect(() => {
    if (required && !isOnboardingPage) router.replace("/dashboard/onboarding");
    if (!required && isOnboardingPage) router.replace("/dashboard");
  }, [required, isOnboardingPage, router]);
  if (required && !isOnboardingPage)
    return (
      <div className="grid min-h-[55vh] place-items-center text-center text-slate-600">
        <div>
          <LoaderCircle className="mx-auto animate-spin" />
          <p className="mt-3">{t("redirectingToCompleteWorkspaceSetup")}</p>
        </div>
      </div>
    );
  if (!required && isOnboardingPage) return null;
  return children;
}
