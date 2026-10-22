import { SchedulesModule } from "@/components/operations/schedules-module";
import { RosterModule } from "@/components/operations/roster-module";
import { redirect } from "next/navigation";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const context = await getPageContext();
  if (!isBusinessAdminRole(context.session.role)) redirect("/dashboard");
  return <><RosterModule /><SchedulesModule /></>;
}
