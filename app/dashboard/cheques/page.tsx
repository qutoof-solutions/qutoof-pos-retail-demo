import { redirect } from "next/navigation";
import { ChequesModule } from "@/components/operations/cheques-module";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";
import { getPageContext } from "@/lib/server/page-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const context = await getPageContext();
  const canReceive = roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception"]);
  const canIssue = roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper"]);
  if (!canReceive && !canIssue) redirect("/dashboard");
  return <ChequesModule canReceive={canReceive} canIssue={canIssue} />;
}
