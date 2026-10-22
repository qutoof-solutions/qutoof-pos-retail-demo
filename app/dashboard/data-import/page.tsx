import { redirect } from "next/navigation";
import { DataImportModule } from "@/components/operations/data-import-module";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function DataImportPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper", "reception"])) redirect("/dashboard");
  return <DataImportModule vertical={context.tenant.vertical} />;
}
