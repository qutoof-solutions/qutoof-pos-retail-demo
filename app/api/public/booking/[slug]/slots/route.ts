import { and, eq } from "drizzle-orm";
import { branches, services } from "@/lib/db/schema";
import { getPublicAvailableSlots, getPublicBookingProviders, isLocalDateWithinBookingWindow } from "@/lib/operations/public-availability";
import { consumePublicRateLimit, loadPublicTenant } from "@/lib/server/public-booking";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const { slug } = await route.params;
  const context = await loadPublicTenant(slug);
  if (!context) return Response.json({ error: "صفحة الحجز غير متاحة" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!await consumePublicRateLimit(context.tenant.id, request, "slots", 60)) return Response.json({ error: "طلبات كثيرة؛ انتظر دقيقة ثم حاول مجدداً" }, { status: 429, headers: { "Retry-After": "60" } });
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? "";
  const serviceId = url.searchParams.get("serviceId") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const providerId = url.searchParams.get("providerId") ?? "any";
  if (!uuidSchema.safeParse(branchId).success || !uuidSchema.safeParse(serviceId).success || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (providerId !== "any" && !uuidSchema.safeParse(providerId).success)) return Response.json({ error: "حدد الفرع والخدمة والتاريخ ومقدم الخدمة بشكل صحيح" }, { status: 400 });
  if (!isLocalDateWithinBookingWindow(date, context.tenant.timezone)) return Response.json({ error: "يمكن الحجز للأيام التسعين القادمة فقط" }, { status: 400 });
  const [branch] = await context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, context.tenant.id), eq(branches.isActive, true))).limit(1);
  const [service] = await context.db.select({ id: services.id, durationMinutes: services.durationMinutes, branchId: services.branchId }).from(services).where(and(eq(services.id, serviceId), eq(services.tenantId, context.tenant.id), eq(services.isActive, true))).limit(1);
  if (!branch || !service || (service.branchId && service.branchId !== branch.id)) return Response.json({ error: "الخدمة أو الفرع غير متاح" }, { status: 404 });
  const providers = await getPublicBookingProviders({ db: context.db, tenantId: context.tenant.id, branchId: branch.id });
  const selectedProvider = providerId === "any" ? null : providerId;
  if (selectedProvider && !providers.some((provider) => provider.id === selectedProvider)) return Response.json({ error: "مقدم الخدمة غير متاح" }, { status: 404 });
  const slots = await getPublicAvailableSlots({ db: context.db, tenantId: context.tenant.id, timezone: context.tenant.timezone, date, branchId: branch.id, durationMinutes: service.durationMinutes, providerIds: providers, requestedProviderId: selectedProvider });
  return Response.json({ slots }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
