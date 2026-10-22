import { PosModule } from "@/components/operations/pos-module";
import { redirect } from "next/navigation";
import { getPageContext } from "@/lib/server/page-access";
import Link from "next/link";
import { WalletCards } from "lucide-react";
import { roleCanAccessDashboardRole } from "@/lib/operations/permissions";
import { getTranslations } from "next-intl/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const context = await getPageContext();
  const tDashboard = await getTranslations("dashboard");
  if (!roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception"])) redirect("/dashboard");
  return <div>{roleCanAccessDashboardRole(context.session.role, ["business_admin"]) && <div className="mb-4 flex justify-end"><Link href="/dashboard/commissions" className="inline-flex items-center gap-2 rounded-xl border border-teal/30 bg-white px-4 py-2 text-sm font-semibold text-teal hover:bg-teal/5"><WalletCards size={17} /> {tDashboard("commissionReport")}</Link></div>}<PosModule businessName={context.tenant.name} /></div>;
}
