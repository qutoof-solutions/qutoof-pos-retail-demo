import { CustomersModule } from "@/components/operations/customers-module";
import { redirect } from "next/navigation";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception", "provider", "nurse"])) redirect("/dashboard");
  return <CustomersModule />;
}
