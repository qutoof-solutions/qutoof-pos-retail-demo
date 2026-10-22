import { redirect } from "next/navigation";
import { PublicProfileModule } from "@/components/settings/public-profile-module";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function PublicBookingSettingsPage() {
  const context = await getPageContext();
  if (!isBusinessAdminRole(context.session.role)) redirect("/404");
  return <PublicProfileModule />;
}
