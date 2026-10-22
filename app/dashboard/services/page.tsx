import { redirect } from "next/navigation";
import { ServicesModule } from "@/components/operations/services-module";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const context = await getPageContext();
  if (!isBusinessAdminRole(context.session.role)) redirect("/dashboard");
  return <ServicesModule />;
}
