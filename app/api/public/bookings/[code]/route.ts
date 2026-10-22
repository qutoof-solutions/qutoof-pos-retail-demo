import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, eq, exists, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, branches, customerEntitlements, customers, digitalTickets, invoiceItems, invoices, services, tenantPublicProfiles, tenants, users, whatsappNotifications } from "@/lib/db/schema";
import { getPublicAvailableSlots, getPublicBookingProviders, isLocalDateWithinBookingWindow } from "@/lib/operations/public-availability";
import { isoDateTimeSchema, uuidSchema } from "@/lib/operations/validation";
import { cancelPendingAppointmentNotifications, dispatchOneWhatsAppNotification, rescheduleBookingNotifications } from "@/services/whatsapp";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { safeEqual } from "@/lib/whatsapp/security";
import { publicManualPayment } from "@/lib/operations/manual-payment";
import { calculateDepositMinor, isRescheduleAllowed, isWithinBookingChangeWindow, normalizeBookingPolicy } from "@/lib/operations/booking-policy";
import { derivePublicDigitalTicketToken, digitalTicketExpiresAt, hashDigitalTicketToken, isDigitalTicketAppointmentEligible } from "@/lib/operations/digital-tickets";
import { assertPreviousMutationChanged, currentAppointmentExists } from "@/lib/operations/gate-mutation";

export const runtime = "edge";
type RouteContext = { params: Promise<{ code: string }> };
const tokenSchema = z.string().min(32).max(100);
const actionSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("cancel"), token: tokenSchema }), z.object({ action: z.literal("reschedule"), token: tokenSchema, startsAt: isoDateTimeSchema, providerId: uuidSchema.nullable().optional() })]);

async function loadBooking(code: string) {
  if (!/^[A-Z0-9_-]{8,64}$/.test(code)) return null;
  const db = getDb();
  const [row] = await db.select({
    appointment: { id: appointments.id, tenantId: appointments.tenantId, branchId: appointments.branchId, customerId: appointments.customerId, serviceId: appointments.serviceId, providerId: appointments.providerId, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, publicBookingCode: appointments.publicBookingCode, publicManageTokenHash: appointments.publicManageTokenHash, paymentPreference: appointments.paymentPreference, whatsappOptIn: appointments.whatsappOptIn, customerResponse: appointments.customerResponse, rescheduleCount: appointments.rescheduleCount },
    tenant: { id: tenants.id, name: tenants.name, logoUrl: tenants.logoUrl, timezone: tenants.timezone },
    customer: { id: customers.id, fullName: customers.fullName, phone: customers.phone },
    service: { id: services.id, name: services.name, durationMinutes: services.durationMinutes },
    branch: { name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn, address: branches.address, mapUrl: branches.mapUrl },
    provider: { fullName: users.fullName },
    ticket: { id: digitalTickets.id, branchId: digitalTickets.branchId, tokenHash: digitalTickets.tokenHash, status: digitalTickets.status, expiresAt: digitalTickets.expiresAt },
    profile: { id: tenantPublicProfiles.id, googleReviewUrl: tenantPublicProfiles.googleReviewUrl, acceptElectronicRequest: tenantPublicProfiles.acceptElectronicRequest, mobileWalletLabel: tenantPublicProfiles.mobileWalletLabel, mobileWalletNumber: tenantPublicProfiles.mobileWalletNumber, instapayLink: tenantPublicProfiles.instapayLink, instapayQrUrl: tenantPublicProfiles.instapayQrUrl, paymentInstructions: tenantPublicProfiles.paymentInstructions, cancellationLeadMinutes: tenantPublicProfiles.cancellationLeadMinutes, maxReschedules: tenantPublicProfiles.maxReschedules, depositRequired: tenantPublicProfiles.depositRequired, depositPercentBps: tenantPublicProfiles.depositPercentBps },
  }).from(appointments)
    .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
    .innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, appointments.tenantId)))
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
    .leftJoin(branches, and(eq(branches.id, appointments.branchId), eq(branches.tenantId, appointments.tenantId)))
    .leftJoin(users, and(eq(users.id, appointments.providerId), eq(users.tenantId, appointments.tenantId)))
    .leftJoin(digitalTickets, and(eq(digitalTickets.appointmentId, appointments.id), eq(digitalTickets.tenantId, appointments.tenantId)))
    .leftJoin(tenantPublicProfiles, eq(tenantPublicProfiles.tenantId, appointments.tenantId))
    .where(and(eq(appointments.publicBookingCode, code), eq(appointments.source, "public_portal"))).limit(1);
  return row ? { ...row, db } : null;
}

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const { code } = await route.params;
  const row = await loadBooking(code);
  if (!row) return Response.json({ error: serverMessage(request, "p1Server.publicManage.notFound") }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const token = new URL(request.url).searchParams.get("token");
  const canManage = Boolean(token && safeEqual(await hashDigitalTicketToken(token), row.appointment.publicManageTokenHash ?? ""));
  let ticketToken: string | null = null;
  if (canManage && token && isDigitalTicketAppointmentEligible(row.appointment.status) && row.ticket && row.ticket.branchId === row.appointment.branchId && row.ticket.status === "issued" && row.ticket.expiresAt.getTime() >= Date.now()) {
    const candidate = await derivePublicDigitalTicketToken(token, row.tenant.id, row.appointment.id);
    if (safeEqual(await hashDigitalTicketToken(candidate), row.ticket.tokenHash)) ticketToken = candidate;
  }
  const bookingPolicy = normalizeBookingPolicy(row.profile);
  const [invoice] = await row.db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, totalMinor: invoices.totalMinor, paidMinor: invoices.paidMinor, currency: invoices.currency }).from(invoices).where(and(eq(invoices.tenantId, row.tenant.id), eq(invoices.appointmentId, row.appointment.id))).limit(1);
  const depositDueMinor = bookingPolicy.depositRequired && invoice ? calculateDepositMinor(invoice.totalMinor, bookingPolicy.depositPercentBps) : 0;
  const bookingInvoice = invoice ? { invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor, paidMinor: invoice.paidMinor, currency: invoice.currency, paymentPreference: row.appointment.paymentPreference } : null;
  let packageInvoice: { invoiceNumber: string; totalMinor: number; paidMinor: number; currency: string; sessions: number; remainingSessions: number; paymentPreference: string } | null = null;
  if (invoice) {
    const items = await row.db.select({ id: invoiceItems.id }).from(invoiceItems).where(and(eq(invoiceItems.tenantId, row.tenant.id), eq(invoiceItems.invoiceId, invoice.id)));
    if (items.length) {
      const [entitlement] = await row.db.select({ totalSessions: customerEntitlements.totalSessions, usedSessions: customerEntitlements.usedSessions }).from(customerEntitlements).where(and(eq(customerEntitlements.tenantId, row.tenant.id), inArray(customerEntitlements.invoiceItemId, items.map((item) => item.id)))).limit(1);
      if (entitlement) packageInvoice = { invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor, paidMinor: invoice.paidMinor, currency: invoice.currency, sessions: entitlement.totalSessions, remainingSessions: Math.max(0, entitlement.totalSessions - entitlement.usedSessions), paymentPreference: row.appointment.paymentPreference };
    }
  }
  const manualPayment = row.appointment.paymentPreference === "electronic_requested" && row.profile?.acceptElectronicRequest ? publicManualPayment(row.profile) : null;
  return Response.json({ booking: { code, businessName: row.tenant.name, logoUrl: row.tenant.logoUrl, timezone: row.tenant.timezone, customerName: row.customer.fullName, serviceName: row.service.name, branchName: row.branch?.name ?? row.tenant.name, branchNameAr: row.branch?.nameAr ?? null, branchNameEn: row.branch?.nameEn ?? null, branchAddress: row.branch?.address ?? null, branchMapUrl: row.branch?.mapUrl ?? null, providerName: row.provider?.fullName ?? null, branchId: row.appointment.branchId, serviceId: row.appointment.serviceId, providerId: row.appointment.providerId, googleReviewUrl: row.profile?.googleReviewUrl ?? null, startsAt: row.appointment.startsAt.toISOString(), endsAt: row.appointment.endsAt.toISOString(), status: row.appointment.status, paymentPreference: row.appointment.paymentPreference, manualPayment, bookingInvoice, customerResponse: row.appointment.customerResponse, canManage, ticketToken, packageInvoice, bookingPolicy, depositDueMinor, rescheduleCount: row.appointment.rescheduleCount } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function PATCH(request: Request, route: RouteContext): Promise<Response> {
  const { code } = await route.params;
  const row = await loadBooking(code);
  if (!row) return Response.json({ error: serverMessage(request, "p1Server.publicManage.notFound") }, { status: 404 });
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: serverMessage(request, "p1Server.publicManage.invalidData") }, { status: 400 });
    const input = parsed.data;
    if (!safeEqual(await hashDigitalTicketToken(input.token), row.appointment.publicManageTokenHash ?? "")) return Response.json({ error: serverMessage(request, "p1Server.publicManage.invalidToken") }, { status: 403 });
    if (!["pending", "confirmed"].includes(row.appointment.status)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.statusNotEditable") }, { status: 409 });
    const now = new Date();
    const bookingPolicy = normalizeBookingPolicy(row.profile);
    if (!isWithinBookingChangeWindow(row.appointment.startsAt, now, bookingPolicy.cancellationLeadMinutes)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.cancellationWindow", { minutes: bookingPolicy.cancellationLeadMinutes }) }, { status: 409 });
    if (input.action === "cancel") {
      const cancelUpdates = [
        row.db.update(appointments).set({ status: "cancelled", cancellationReason: serverMessage(request, "p1Server.publicManage.cancelledByCustomer"), customerResponse: null, customerResponseAt: null, updatedAt: now }).where(and(eq(appointments.id, row.appointment.id), eq(appointments.tenantId, row.tenant.id), inArray(appointments.status, ["pending", "confirmed"]), currentAppointmentExists({ ...row.appointment, tenantId: row.tenant.id }, false))),
        ...(row.ticket ? [
          row.db.update(digitalTickets).set({ status: "revoked" }).where(and(eq(digitalTickets.id, row.ticket.id), eq(digitalTickets.tenantId, row.tenant.id), eq(digitalTickets.appointmentId, row.appointment.id), inArray(digitalTickets.status, ["issued", "checked_in", "expired"]), sql`changes() = 1`)),
          row.db.run(assertPreviousMutationChanged()),
        ] : []),
      ] as const;
      const cancelResults = await row.db.batch(cancelUpdates);
      if ((cancelResults[0]?.meta as { changes?: number } | undefined)?.changes !== 1 || (row.ticket && (cancelResults[1]?.meta as { changes?: number } | undefined)?.changes !== 1)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.concurrentChange") }, { status: 409 });
      let notificationWarning: string | null = null;
      try { await cancelPendingAppointmentNotifications(row.db, row.tenant.id, row.appointment.id); }
      catch { notificationWarning = serverMessage(request, "p1Server.publicManage.cancelledWhatsappSyncFailed"); }
      return Response.json({ updated: true, status: "cancelled", notificationWarning }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!isRescheduleAllowed(row.appointment.rescheduleCount, bookingPolicy.maxReschedules)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.rescheduleLimit", { count: bookingPolicy.maxReschedules }) }, { status: 409 });
    const startsAt = input.startsAt;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: row.tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(startsAt);
    if (!isLocalDateWithinBookingWindow(date, row.tenant.timezone) || startsAt.getTime() < now.getTime() + 15 * 60_000) return Response.json({ error: serverMessage(request, "p1Server.publicManage.invalidDate") }, { status: 400 });
    if (row.ticket && row.ticket.status !== "issued") return Response.json({ error: serverMessage(request, "p1Server.publicManage.ticketUsed") }, { status: 409 });
    if (!row.appointment.branchId) return Response.json({ error: serverMessage(request, "p1Server.publicManage.branchUnavailable") }, { status: 409 });
    const providers = await getPublicBookingProviders({ db: row.db, tenantId: row.tenant.id, branchId: row.appointment.branchId });
    const requestedProviderId = input.providerId === undefined ? row.appointment.providerId : input.providerId;
    if (requestedProviderId && !providers.some((provider) => provider.id === requestedProviderId)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.providerUnavailable") }, { status: 404 });
    const slots = await getPublicAvailableSlots({ db: row.db, tenantId: row.tenant.id, timezone: row.tenant.timezone, date, branchId: row.appointment.branchId, durationMinutes: row.service.durationMinutes, providerIds: providers, requestedProviderId });
    const selected = slots.find((slot) => new Date(slot.startsAt).getTime() === startsAt.getTime());
    if (!selected) return Response.json({ error: serverMessage(request, "p1Server.publicManage.slotUnavailable") }, { status: 409 });
    const endsAt = new Date(startsAt.getTime() + row.service.durationMinutes * 60_000);
    try {
      const issuedTicket = row.ticket ? row.db.select({ id: digitalTickets.id }).from(digitalTickets).where(and(eq(digitalTickets.id, row.ticket.id), eq(digitalTickets.tenantId, row.tenant.id), eq(digitalTickets.appointmentId, row.appointment.id), eq(digitalTickets.status, "issued"), eq(digitalTickets.expiresAt, row.ticket.expiresAt))) : null;
      const updates = [row.db.update(appointments).set({ providerId: selected.providerId, startsAt, endsAt, rescheduleCount: row.appointment.rescheduleCount + 1, customerResponse: null, customerResponseAt: null, updatedAt: now }).where(and(eq(appointments.id, row.appointment.id), eq(appointments.tenantId, row.tenant.id), inArray(appointments.status, ["pending", "confirmed"]), eq(appointments.status, row.appointment.status), eq(appointments.rescheduleCount, row.appointment.rescheduleCount), currentAppointmentExists({ ...row.appointment, tenantId: row.tenant.id }, false), ...(issuedTicket ? [exists(issuedTicket)] : []))),
        ...(row.ticket ? [
          row.db.update(digitalTickets).set({ expiresAt: digitalTicketExpiresAt(endsAt) }).where(and(eq(digitalTickets.id, row.ticket.id), eq(digitalTickets.tenantId, row.tenant.id), eq(digitalTickets.appointmentId, row.appointment.id), eq(digitalTickets.status, "issued"), eq(digitalTickets.expiresAt, row.ticket.expiresAt), sql`changes() = 1`)),
          row.db.run(assertPreviousMutationChanged()),
        ] : []),
      ] as const;
      const results = await row.db.batch(updates);
      if ((results[0]?.meta as { changes?: number } | undefined)?.changes !== 1 || (row.ticket && (results[1]?.meta as { changes?: number } | undefined)?.changes !== 1)) return Response.json({ error: serverMessage(request, "p1Server.publicManage.concurrentChange") }, { status: 409 });
    } catch (error) {
      if (String(error).includes("APPOINTMENT_PROVIDER_OVERLAP")) return Response.json({ error: serverMessage(request, "p1Server.publicManage.slotTaken") }, { status: 409 });
      throw error;
    }
    let notificationWarning: string | null = null;
    if (row.appointment.whatsappOptIn) {
      try {
        await rescheduleBookingNotifications(row.db, { tenantId: row.tenant.id, appointmentId: row.appointment.id, customerPhone: row.customer.phone, startsAt, endsAt });
        const dedupeKey = `${row.appointment.id}:reschedule:${startsAt.getTime()}`;
        const [confirmation] = await row.db.select({ id: whatsappNotifications.id }).from(whatsappNotifications).where(and(eq(whatsappNotifications.tenantId, row.tenant.id), eq(whatsappNotifications.dedupeKey, dedupeKey))).limit(1);
        if (confirmation) await dispatchOneWhatsAppNotification(row.db, getRuntimeEnv(), confirmation.id);
      } catch { notificationWarning = serverMessage(request, "p1Server.publicManage.updatedWhatsappSyncFailed"); }
    }
    return Response.json({ updated: true, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), providerId: selected.providerId, notificationWarning }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: serverMessage(request, "p1Server.publicManage.updateFailed") }, { status: 500 }); }
}
