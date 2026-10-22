import { redirect } from "next/navigation";
import { MovementsModule } from "@/components/operations/movements-module";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function MovementsPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper"])) redirect("/dashboard");
  return <MovementsModule />;
}
