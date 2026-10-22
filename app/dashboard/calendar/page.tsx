import { redirect } from "next/navigation";
import { CalendarModule } from "@/components/operations/calendar-module";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole, isFrontDeskRole, isClinicalRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const context = await getPageContext();
  if (!(isBusinessAdminRole(context.session.role) || isFrontDeskRole(context.session.role) || isClinicalRole(context.session.role))) redirect("/dashboard");
  return <CalendarModule canAssignProvider={isBusinessAdminRole(context.session.role) || isFrontDeskRole(context.session.role)} />;
}
