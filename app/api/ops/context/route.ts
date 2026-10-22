import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { requireOperationAccess } from "@/lib/server/operations";
import { branchMemberships, branches, services, tenantPublicProfiles, users } from "@/lib/db/schema";
import { isBusinessAdminRole, isClinicalRole, isFrontDeskRole, isNursingRole } from "@/lib/operations/permissions";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";
import { signOfflinePrice } from "@/lib/operations/offline-price";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider", "nurse"]);
  if (!access.ok) return access.response;
  const { db, tenantId, session } = access.context;
  const canCreateCustomer = isBusinessAdminRole(session.role) || isFrontDeskRole(session.role);
  const branchIds = await getAccessibleBranchIds(access.context);
  const [printProfile] = await db.select({ invoiceTerms: tenantPublicProfiles.invoiceTerms, invoiceNotes: tenantPublicProfiles.invoiceNotes }).from(tenantPublicProfiles).where(eq(tenantPublicProfiles.tenantId, tenantId)).limit(1);
  const printSettings = { invoiceTerms: printProfile?.invoiceTerms ?? "", invoiceNotes: printProfile?.invoiceNotes ?? "" };
  if (!branchIds.length) return Response.json({ branches: [], services: [], providers: [], ...printSettings, vertical: access.context.tenant.vertical, timezone: access.context.tenant.timezone, scope: { tenantId, userId: session.sub }, canReviewOfflineConflicts: isBusinessAdminRole(session.role), canCreateCustomer }, { headers: { "Cache-Control": "no-store" } });
  const [branchRows, serviceRows, providerRows] = await Promise.all([
    db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn, address: branches.address, isActive: branches.isActive }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true), inArray(branches.id, branchIds))).orderBy(asc(branches.name)),
    db.select({ id: services.id, name: services.name, kind: services.kind, priceMinor: services.priceMinor, durationMinutes: services.durationMinutes, branchId: services.branchId, sessionCount: services.sessionCount }).from(services).where(and(eq(services.tenantId, tenantId), eq(services.isActive, true), or(isNull(services.branchId), inArray(services.branchId, branchIds)))).orderBy(asc(services.name)),
    db.selectDistinct({ id: users.id, fullName: users.fullName }).from(users).innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, tenantId), inArray(branchMemberships.branchId, branchIds))).where(and(eq(users.tenantId, tenantId), inArray(users.role, ["provider", "doctor", "specialist"]), eq(users.isActive, true))).orderBy(asc(users.fullName)),
  ]);
  const providers = isClinicalRole(session.role) ? providerRows.filter((provider) => provider.id === session.sub) : isNursingRole(session.role) ? [] : providerRows;
  const signedServices = await Promise.all(serviceRows.map(async (service) => ({
    ...service,
    offlinePriceToken: await signOfflinePrice(access.context.env.SESSION_SECRET!, {
      tenantId,
      itemType: "service",
      itemId: service.id,
      branchId: service.branchId,
      unitPriceMinor: service.priceMinor,
      issuedAt: Date.now(),
    }),
  })));
  return Response.json({ branches: branchRows, services: isNursingRole(session.role) ? [] : signedServices, providers, ...printSettings, vertical: access.context.tenant.vertical, timezone: access.context.tenant.timezone, scope: { tenantId, userId: session.sub }, canReviewOfflineConflicts: isBusinessAdminRole(session.role), canCreateCustomer }, { headers: { "Cache-Control": "no-store" } });
}
