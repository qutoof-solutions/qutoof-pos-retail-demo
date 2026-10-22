import { redirect } from "next/navigation";
import { MedicalContractsModule } from "@/components/operations/medical-contracts-module";
import { MedicalSettingsModule } from "@/components/operations/medical-settings-module";
import { getPageContext } from "@/lib/server/page-access";
import { isBusinessAdminRole } from "@/lib/operations/permissions";
export const runtime="edge"; export const dynamic="force-dynamic";
export default async function MedicalToolsPage(){const context=await getPageContext(); if(!isBusinessAdminRole(context.session.role)&&!['provider','doctor','specialist'].includes(context.session.role)) redirect("/404"); return <div className="space-y-5"><MedicalSettingsModule/><MedicalContractsModule/></div>;}
