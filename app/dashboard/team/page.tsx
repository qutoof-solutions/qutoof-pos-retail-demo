import { redirect } from "next/navigation";
import { TeamModule } from "@/components/operations/team-module";
import { getPageContext } from "@/lib/server/page-access";
import { isOwnerRole } from "@/lib/operations/permissions";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const context = await getPageContext();
  if (!isOwnerRole(context.session.role)) redirect("/dashboard");
  return <TeamModule />;
}
