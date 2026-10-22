import { QueueModule } from "@/components/operations/queue-module";
import { redirect } from "next/navigation";
import { getPageContext } from "@/lib/server/page-access";
import { isClinicalRole, roleCanAccessDashboardRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception", "provider"])) redirect("/dashboard");
  return <QueueModule clinical={isClinicalRole(context.session.role)} />;
}
