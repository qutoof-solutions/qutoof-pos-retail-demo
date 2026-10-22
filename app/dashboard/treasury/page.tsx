import { redirect } from "next/navigation";
import { TreasuryModule } from "@/components/operations/treasury-module";
import { branches } from "@/lib/db/schema";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";
import { and, asc, eq, inArray } from "drizzle-orm";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  const context = await getPageContext();
  if (!isBusinessAdminRole(context.session.role)) redirect("/dashboard");
  const branchIds = await getAccessibleBranchIds(context);
  const branchRows = branchIds.length ? await context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).where(and(eq(branches.tenantId, context.tenantId), eq(branches.isActive, true), inArray(branches.id, branchIds))).orderBy(asc(branches.name)) : [];
  return <TreasuryModule branches={branchRows} />;
}
