import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { platformFeatureFlags } from "@/lib/db/schema";
import { normalizeFeatureKey } from "@/lib/platform/billing";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";
const toggleSchema = z.object({ key: z.string().min(1).max(64), enabled: z.boolean() }).strict();

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const flags = await access.context.db.select().from(platformFeatureFlags).orderBy(asc(platformFeatureFlags.key));
  return Response.json({ flags }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).origin !== new URL(request.url).origin) return Response.json({ errorCode: "forbiddenRequest", error: serverMessage(request, "p1Server.featureFlags.forbiddenRequest") }, { status: 403 });
  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ errorCode: "invalidInput", error: serverMessage(request, "p1Server.featureFlags.invalidInput") }, { status: 400 });
  const key = normalizeFeatureKey(parsed.data.key);
  const [existing] = await access.context.db.select({ key: platformFeatureFlags.key, enabled: platformFeatureFlags.enabled }).from(platformFeatureFlags).where(eq(platformFeatureFlags.key, key)).limit(1);
  if (!existing) return Response.json({ errorCode: "unknownFeature", error: serverMessage(request, "p1Server.featureFlags.unknownFeature") }, { status: 404 });
  await access.context.db.update(platformFeatureFlags).set({ enabled: parsed.data.enabled, updatedBy: access.context.user.id, updatedAt: new Date() }).where(eq(platformFeatureFlags.key, key)).run();
  await writePlatformAudit(access.context, request, "platform.feature_flag_changed", "platform_feature_flag", key, { enabled: parsed.data.enabled });
  return Response.json({ key, enabled: parsed.data.enabled }, { headers: { "Cache-Control": "no-store" } });
}
