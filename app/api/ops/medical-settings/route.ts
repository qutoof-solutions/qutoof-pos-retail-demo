import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenants } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
export const runtime = "edge";
const inputSchema = z.object({ followUpDays: z.number().int().min(0).max(90) });
function readSettings(value: string | null): Record<string, unknown> { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "doctor", "specialist"]);
  if (!access.ok) return access.response;
  try { const settings = readSettings(access.context.tenant.settingsJson); const medical = settings.medical && typeof settings.medical === "object" ? settings.medical as Record<string, unknown> : {}; return Response.json({ followUpDays: Number.isInteger(medical.followUpDays) ? medical.followUpDays : 14 }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error, "تعذر تحميل إعدادات العمليات الطبية"); }
}
export async function PUT(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try { const input = inputSchema.parse(await request.json()); const settings = readSettings(access.context.tenant.settingsJson); const currentMedical = settings.medical && typeof settings.medical === "object" ? settings.medical as Record<string, unknown> : {}; const nextSettings = { ...settings, medical: { ...currentMedical, followUpDays: input.followUpDays } }; await access.context.db.update(tenants).set({ settingsJson: JSON.stringify(nextSettings), updatedAt: new Date() }).where(eq(tenants.id, access.context.tenantId)).run(); await writeAudit(access.context, request, "medical.settings.follow_up_days_updated", "tenant_settings", access.context.tenantId, { followUpDays: input.followUpDays }); return Response.json({ saved: true, followUpDays: input.followUpDays }); } catch (error) { return errorResponse(error, "تعذر حفظ إعدادات العمليات الطبية"); }
}
