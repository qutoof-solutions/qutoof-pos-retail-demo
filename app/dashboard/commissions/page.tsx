import { redirect } from "next/navigation";
import { CommissionsModule } from "@/components/operations/commissions-module";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function CommissionsPage() {
  const context = await getPageContext();
  if (!isBusinessAdminRole(context.session.role)) redirect("/404");
  return <CommissionsModule timezone={context.tenant.timezone} />;
}
