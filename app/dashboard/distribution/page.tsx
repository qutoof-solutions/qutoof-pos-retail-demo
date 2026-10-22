import { redirect } from "next/navigation";
import { DistributionModule } from "@/components/operations/distribution-module";
import { branches } from "@/lib/db/schema";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole, roleCanAccessDashboardRole } from "@/lib/operations/permissions";
import { eq, inArray, and, asc } from "drizzle-orm";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  const context = await getPageContext();
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "storekeeper"])) redirect("/dashboard");
  const branchIds = await getAccessibleBranchIds(context);
  const branchRows = branchIds.length ? await context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, context.tenantId), eq(branches.isActive, true), inArray(branches.id, branchIds))).orderBy(asc(branches.name)) : [];
  return <DistributionModule branches={branchRows} canManage={isBusinessAdminRole(context.session.role)} canOpenTrip={isBusinessAdminRole(context.session.role) || context.session.role === "storekeeper"} />;
}
