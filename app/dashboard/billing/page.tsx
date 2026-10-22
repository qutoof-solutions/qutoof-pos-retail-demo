import { BillingPanel } from "@/components/platform/billing-panel";
import { getPageContext } from "@/lib/server/page-access";
import { isOwnerRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function TenantBillingPage() {
  const context = await getPageContext();
  return <BillingPanel canManage={isOwnerRole(context.session.role)} initialStatus={context.tenant.status} />;
}
