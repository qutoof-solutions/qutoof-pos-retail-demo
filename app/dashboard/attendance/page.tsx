import { redirect } from "next/navigation";
import { AttendanceModule } from "@/components/operations/attendance-module";
import { getPageContext } from "@/lib/server/page-access";
import { roleCanAccessDashboardRole, isBusinessAdminRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception", "provider", "nurse", "storekeeper"])) redirect("/dashboard");
  return <AttendanceModule canManage={isBusinessAdminRole(context.session.role)} />;
}
