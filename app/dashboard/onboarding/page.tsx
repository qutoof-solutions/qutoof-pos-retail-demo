import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/operations/onboarding-wizard";
import { getPageContext } from "@/lib/server/page-access";
import { isOwnerRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await getPageContext();
  if (!isOwnerRole(context.session.role)) redirect("/dashboard");
  return <OnboardingWizard />;
}
