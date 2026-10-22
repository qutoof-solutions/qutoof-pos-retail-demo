import { eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { tenantPublicProfiles, tenants } from "@/lib/db/schema";
import { deriveTenantBillingStatus, operationalAccessAllowed } from "@/lib/platform/billing";
import { isFeatureEnabled, isPlanFeatureEnabled } from "@/lib/platform/features";

export async function loadPublicTenant(slug: string) {
  if (!/^[a-z0-9\u0600-\u06ff-]+$/i.test(slug) || slug.length > 64) return null;
  const db = getDb();
  const [row] = await db.select({ tenant: tenants, profile: tenantPublicProfiles }).from(tenants)
    .leftJoin(tenantPublicProfiles, eq(tenantPublicProfiles.tenantId, tenants.id))
    .where(eq(tenants.slug, slug)).limit(1);
  if (!row || !row.profile || !row.profile.bookingEnabled || !operationalAccessAllowed(deriveTenantBillingStatus(row.tenant))) return null;
  const [bookingEnabled, maintenanceMode, planAllowsBooking] = await Promise.all([isFeatureEnabled(db, "public_booking", true), isFeatureEnabled(db, "maintenance_mode", false), isPlanFeatureEnabled(db, row.tenant.platformPlanId, "public_booking")]);
  if (!bookingEnabled || maintenanceMode || !planAllowsBooking) return null;
  return { ...row, profile: row.profile, db, env: getRuntimeEnv() };
}

export async function consumePublicRateLimit(tenantId: string, request: Request, action: "slots" | "booking", limit = 30): Promise<boolean> {
  const env = getRuntimeEnv();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const fingerprint = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${tenantId}:${action}:${ip}`));
  const key = Array.from(new Uint8Array(fingerprint).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `public-rate:${key}`;
  const now = Date.now();
  const windowMs = 60_000;
  const previous = await env.KV_BINDING.get(storageKey);
  let record = { windowStart: now, count: 0 };
  if (previous) {
    try {
      const parsed = JSON.parse(previous) as { windowStart: number; count: number };
      if (Number.isFinite(parsed.windowStart) && Number.isInteger(parsed.count) && now - parsed.windowStart < windowMs && now >= parsed.windowStart) record = parsed;
    } catch { record = { windowStart: now, count: 0 }; }
  }
  if (record.count >= limit) return false;
  await env.KV_BINDING.put(storageKey, JSON.stringify({ windowStart: record.windowStart, count: record.count + 1 }), { expirationTtl: 120 });
  return true;
}

export { localDateKey, localTimeToUtc } from "@/lib/time/timezone";
