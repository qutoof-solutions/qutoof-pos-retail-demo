import { redirect } from "next/navigation";
import { WhatsAppSettingsModule } from "@/components/settings/whatsapp-settings-module";
import { getPageContext } from "@/lib/server/page-access";
import { isOwnerRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export default async function WhatsAppSettingsPage() {
  const context = await getPageContext();
  if (!isOwnerRole(context.session.role)) redirect("/404");
  return <WhatsAppSettingsModule />;
}
