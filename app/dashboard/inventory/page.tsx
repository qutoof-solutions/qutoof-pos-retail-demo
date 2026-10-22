import { redirect } from "next/navigation";
import { InventoryModule } from "@/components/operations/inventory-module";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function InventoryPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper"])) redirect("/dashboard");
  return <InventoryModule businessName={context.tenant.name} />;
}
