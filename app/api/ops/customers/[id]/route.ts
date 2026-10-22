import { and, asc, desc, eq, exists, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { appointments, customerEntitlementUsages, customerEntitlements, customerMemberships, membershipFreezes, customers, invoiceItems, invoicePayments, invoices, patientRecords, services, subscriptionPlans, users } from "@/lib/db/schema";
import { requireOperationAccess } from "@/lib/server/operations";
import { isBusinessAdminRole, isClinicalRole, isFrontDeskRole, isNursingRole } from "@/lib/operations/permissions";
import { getCustomerBranchScope } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider", "nurse"]);
  if (!access.ok) return access.response;
  const { id } = await route.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "معرف العميل غير صالح" }, { status: 400 });
  const { db, tenantId, session } = access.context;
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId))).limit(1);
  if (!customer) return Response.json({ error: "العميل غير موجود" }, { status: 404 });
  let scope;
  try { scope = await getCustomerBranchScope(access.context, id); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "العميل غير موجود" }, { status: 404 }); }
  if (isClinicalRole(session.role)) {
    const ownVisits = scope.appointmentIds.length ? await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, tenantId), eq(appointments.customerId, id), eq(appointments.providerId, session.sub), inArray(appointments.id, scope.appointmentIds))).limit(1) : [];
    if (!ownVisits.length) return Response.json({ error: "لا تملك صلاحية الوصول إلى ملف هذا العميل" }, { status: 403 });
  }
  const clinicalRecordScope = or(
    eq(patientRecords.authorId, session.sub),
    exists(db.select({ id: appointments.id }).from(appointments).where(and(
      eq(appointments.id, patientRecords.appointmentId),
      eq(appointments.tenantId, tenantId),
      eq(appointments.providerId, session.sub),
    ))),
  )!;
  const recordBranchScope = scope.customerBranchId && scope.accessibleBranchIds.includes(scope.customerBranchId)
    ? or(isNull(patientRecords.appointmentId), scope.appointmentIds.length ? inArray(patientRecords.appointmentId, scope.appointmentIds) : undefined)!
    : scope.appointmentIds.length ? inArray(patientRecords.appointmentId, scope.appointmentIds) : isNull(patientRecords.appointmentId);
  const recordQuery = isBusinessAdminRole(session.role)
    ? db.select().from(patientRecords).where(and(eq(patientRecords.tenantId, tenantId), eq(patientRecords.customerId, id), recordBranchScope)).orderBy(asc(patientRecords.createdAt))
    : isClinicalRole(session.role)
      ? db.select().from(patientRecords).where(and(eq(patientRecords.tenantId, tenantId), eq(patientRecords.customerId, id), clinicalRecordScope, recordBranchScope)).orderBy(asc(patientRecords.createdAt))
      : isNursingRole(session.role)
        ? db.select().from(patientRecords).where(and(eq(patientRecords.tenantId, tenantId), eq(patientRecords.customerId, id), eq(patientRecords.recordType, "attachment"), recordBranchScope)).orderBy(asc(patientRecords.createdAt))
      : Promise.resolve([]);
  const [visits, records, entitlements] = await Promise.all([
    scope.appointmentIds.length ? db.select({ id: appointments.id, branchId: appointments.branchId, serviceId: appointments.serviceId, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, serviceName: services.name, providerId: appointments.providerId, providerName: users.fullName }).from(appointments).innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, tenantId))).leftJoin(users, and(eq(users.id, appointments.providerId), eq(users.tenantId, tenantId))).where(and(eq(appointments.tenantId, tenantId), eq(appointments.customerId, id), inArray(appointments.id, scope.appointmentIds), ...(isClinicalRole(session.role) ? [eq(appointments.providerId, session.sub)] : []))).orderBy(asc(appointments.startsAt)) : Promise.resolve([]),
    recordQuery,
    isNursingRole(session.role) ? Promise.resolve([]) : db.select({ id: customerEntitlements.id, serviceId: customerEntitlements.serviceId, serviceName: services.name, invoiceItemId: customerEntitlements.invoiceItemId, totalSessions: customerEntitlements.totalSessions, usedSessions: customerEntitlements.usedSessions, validUntil: customerEntitlements.validUntil, status: customerEntitlements.status, createdAt: customerEntitlements.createdAt }).from(customerEntitlements).innerJoin(services, and(eq(services.id, customerEntitlements.serviceId), eq(services.tenantId, tenantId))).where(and(eq(customerEntitlements.tenantId, tenantId), eq(customerEntitlements.customerId, id), exists(db.select({ id: invoices.id }).from(invoiceItems).innerJoin(invoices, and(eq(invoices.id, invoiceItems.invoiceId), eq(invoices.tenantId, tenantId))).where(and(eq(invoiceItems.id, customerEntitlements.invoiceItemId), eq(invoiceItems.tenantId, tenantId), inArray(invoices.branchId, scope.accessibleBranchIds)))))).orderBy(asc(customerEntitlements.createdAt)),
  ]);
  const usages = entitlements.length && scope.appointmentIds.length ? await db.select().from(customerEntitlementUsages).where(and(eq(customerEntitlementUsages.tenantId, tenantId), inArray(customerEntitlementUsages.entitlementId, entitlements.map((item) => item.id)), inArray(customerEntitlementUsages.appointmentId, scope.appointmentIds))) : [];
  const canManageMemberships = access.context.tenant.vertical === "sports" && (isBusinessAdminRole(session.role) || isFrontDeskRole(session.role));
  const canManageGym = access.context.tenant.vertical === "sports" && (isBusinessAdminRole(session.role) || isFrontDeskRole(session.role) || isClinicalRole(session.role));
  const [membershipRows, membershipPlans] = (canManageMemberships || canManageGym) ? await Promise.all([
    scope.accessibleBranchIds.length ? db.select().from(customerMemberships).where(and(eq(customerMemberships.tenantId, tenantId), eq(customerMemberships.customerId, id), inArray(customerMemberships.branchId, scope.accessibleBranchIds))).orderBy(desc(customerMemberships.createdAt)) : Promise.resolve([]),
    db.select({ id: subscriptionPlans.id, nameAr: subscriptionPlans.nameAr, nameEn: subscriptionPlans.nameEn, billingCycle: subscriptionPlans.billingCycle, customDays: subscriptionPlans.customDays, priceMinor: subscriptionPlans.priceMinor, currency: subscriptionPlans.currency }).from(subscriptionPlans).where(and(eq(subscriptionPlans.isActive, true), or(eq(subscriptionPlans.tenantId, tenantId), isNull(subscriptionPlans.tenantId)))).orderBy(asc(subscriptionPlans.priceMinor)),
  ]) : [[], []];
  const membershipIds = membershipRows.map((row) => row.id);
  const freezeRows = membershipIds.length ? await db.select().from(membershipFreezes).where(and(eq(membershipFreezes.tenantId, tenantId), inArray(membershipFreezes.membershipId, membershipIds))).orderBy(asc(membershipFreezes.createdAt)) : [];
  let billing: Array<{ invoice: typeof invoices.$inferSelect; payments: Array<typeof invoicePayments.$inferSelect> }> = [];
  if (isBusinessAdminRole(session.role) || isFrontDeskRole(session.role)) {
    const invoiceRows = await db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id), inArray(invoices.branchId, scope.accessibleBranchIds))).orderBy(asc(invoices.createdAt));
    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const paymentRows = invoiceIds.length ? await db.select().from(invoicePayments).where(and(eq(invoicePayments.tenantId, tenantId), inArray(invoicePayments.invoiceId, invoiceIds))).orderBy(asc(invoicePayments.createdAt)) : [];
    billing = invoiceRows.map((invoice) => ({ invoice, payments: paymentRows.filter((payment) => payment.invoiceId === invoice.id) }));
  }
  return Response.json({
    customer: { ...customer, notes: customer.notes },
    visits,
    records: records.map((record) => ({ id: record.id, customerId: record.customerId, appointmentId: record.appointmentId, recordType: record.recordType, title: record.title, body: record.body, metadataJson: record.metadataJson, createdAt: record.createdAt })),
    billing,
    entitlements: entitlements.map((item) => ({ ...item, usages: usages.filter((usage) => usage.entitlementId === item.id) })),
    memberships: membershipRows.map((membership) => ({ ...membership, freezes: freezeRows.filter((freeze) => freeze.membershipId === membership.id) })),
    membershipPlans,
    canManageMemberships,
    canManageGym,
    canWriteRecords: isBusinessAdminRole(session.role) || isClinicalRole(session.role),
    canManageAttachments: isBusinessAdminRole(session.role) || isClinicalRole(session.role) || isNursingRole(session.role),
    canSeeBilling: isBusinessAdminRole(session.role) || isFrontDeskRole(session.role),
    canConsumeEntitlements: isBusinessAdminRole(session.role) || isFrontDeskRole(session.role) || isClinicalRole(session.role),
  }, { headers: { "Cache-Control": "no-store" } });
}
