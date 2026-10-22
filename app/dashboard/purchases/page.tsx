import { redirect } from "next/navigation";
import { PurchasesModule } from "@/components/operations/purchases-module";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function PurchasesPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper"])) redirect("/dashboard");
  return <PurchasesModule />;
}
