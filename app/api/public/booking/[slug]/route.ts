import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { BatchItem } from "drizzle-orm/batch";
import { appointments, branches, customerEntitlementUsages, customerEntitlements, customers, digitalTickets, invoiceItems, invoices, schedules, services, whatsappNotifications } from "@/lib/db/schema";
import { ApiError, errorResponse } from "@/lib/server/operations";
import { getPublicAvailableSlots, getPublicBookingProviders, isLocalDateWithinBookingWindow } from "@/lib/operations/public-availability";
import { consumePublicRateLimit, loadPublicTenant } from "@/lib/server/public-booking";
import { isoDateTimeSchema, phoneSchema, uuidSchema } from "@/lib/operations/validation";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/security";
import { dispatchOneWhatsAppNotification, enqueueBookingNotifications } from "@/services/whatsapp";
import { getRuntimeEnv } from "@/lib/db/client";
import { publicManualPayment } from "@/lib/operations/manual-payment";
import { calculateDepositMinor, normalizeBookingPolicy } from "@/lib/operations/booking-policy";
import { derivePublicDigitalTicketToken, digitalTicketExpiresAt, hashDigitalTicketToken } from "@/lib/operations/digital-tickets";

export const runtime = "edge";
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, route: RouteContext): Promise<Response> {
  const { slug } = await route.params;
  const context = await loadPublicTenant(slug);
  if (!context) return Response.json({ error: "صفحة الحجز غير متاحة" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const [branchRows, serviceRows, providers, businessHours] = await Promise.all([
    context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn, address: branches.address, phone: branches.phone, mapUrl: branches.mapUrl }).from(branches).where(and(eq(branches.tenantId, context.tenant.id), eq(branches.isActive, true))).orderBy(asc(branches.name)),
    context.db.select({ id: services.id, name: services.name, description: services.description, kind: services.kind, priceMinor: services.priceMinor, currency: services.currency, durationMinutes: services.durationMinutes, sessionCount: services.sessionCount, branchId: services.branchId }).from(services).where(and(eq(services.tenantId, context.tenant.id), eq(services.isActive, true))).orderBy(asc(services.name)),
    getPublicBookingProviders({ db: context.db, tenantId: context.tenant.id }),
    context.db.select({ id: schedules.id, branchId: schedules.branchId, providerId: schedules.providerId, weekday: schedules.weekday, startsAt: schedules.startsAt, endsAt: schedules.endsAt }).from(schedules).where(and(eq(schedules.tenantId, context.tenant.id), eq(schedules.isAvailable, true))).orderBy(asc(schedules.weekday)),
  ]);
  const availableServices = serviceRows.filter((service) => !service.branchId || branchRows.some((branch) => branch.id === service.branchId));
  const manualPayment = publicManualPayment(context.profile);
  const acceptElectronicRequest = context.profile.acceptElectronicRequest && Boolean(manualPayment);
  const bookingPolicy = normalizeBookingPolicy(context.profile);
  return Response.json({ venue: { name: context.tenant.name, slug: context.tenant.slug, vertical: context.tenant.vertical, timezone: context.tenant.timezone, logoUrl: context.tenant.logoUrl, contactPhone: context.tenant.contactPhone, description: context.profile.description, acceptElectronicRequest, manualPayment: acceptElectronicRequest ? manualPayment : null, googleReviewUrl: context.profile.googleReviewUrl, bookingPolicy }, branches: branchRows, services: availableServices, providers, businessHours }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

const bookingInput = z.object({ branchId: uuidSchema, serviceId: uuidSchema, providerId: uuidSchema.nullable(), startsAt: isoDateTimeSchema, fullName: z.string().trim().min(5).max(160).refine((name) => name.split(/\s+/).filter(Boolean).length >= 3, "اكتب الاسم ثلاثياً على الأقل"), phone: phoneSchema, notes: z.string().trim().max(1200).nullable().optional(), paymentPreference: z.enum(["cash_at_visit", "electronic_requested"]), whatsappConsent: z.boolean() });

function randomUrlToken(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const { slug } = await route.params;
  const context = await loadPublicTenant(slug);
  if (!context) return Response.json({ error: "صفحة الحجز غير متاحة" }, { status: 404 });
  if (!await consumePublicRateLimit(context.tenant.id, request, "booking", 5)) return Response.json({ error: "وصلت إلى حد الحجوزات المؤقت؛ حاول بعد دقيقة" }, { status: 429, headers: { "Retry-After": "60" } });
  try {
    const parsed = bookingInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "تحقق من بيانات الحجز");
    const input = parsed.data;
    const bookingPolicy = normalizeBookingPolicy(context.profile);
    if (bookingPolicy.depositRequired && input.paymentPreference !== "electronic_requested") throw new ApiError("تتطلب سياسة المنشأة دفع العربون مسبقًا؛ اختر طلب الدفع الإلكتروني للمتابعة");
    if (bookingPolicy.depositRequired && (!context.profile.acceptElectronicRequest || !publicManualPayment(context.profile))) throw new ApiError("بيانات تحصيل العربون غير مهيأة؛ تواصل مع المنشأة");
    if (input.paymentPreference === "electronic_requested" && (!context.profile.acceptElectronicRequest || !publicManualPayment(context.profile))) throw new ApiError("الدفع الإلكتروني غير مهيأ لهذا النشاط؛ اختر الدفع عند الحضور أو تواصل مع المنشأة");
    const phoneDigits = normalizeWhatsAppPhone(input.phone);
    if (!phoneDigits) throw new ApiError("أدخل رقم هاتف دولياً صحيحاً مع مفتاح الدولة");
    const phone = `+${phoneDigits}`;
    const start = input.startsAt;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: context.tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
    if (!isLocalDateWithinBookingWindow(date, context.tenant.timezone) || start.getTime() < Date.now() + 15 * 60_000) throw new ApiError("اختر موعداً خلال التسعين يوماً القادمة وبعد 15 دقيقة على الأقل");
    const [branch] = await context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, context.tenant.id), eq(branches.isActive, true))).limit(1);
    const [service] = await context.db.select({ id: services.id, name: services.name, kind: services.kind, priceMinor: services.priceMinor, currency: services.currency, durationMinutes: services.durationMinutes, sessionCount: services.sessionCount, validityDays: services.validityDays, providerCommissionBps: services.providerCommissionBps, branchId: services.branchId, isActive: services.isActive }).from(services).where(and(eq(services.id, input.serviceId), eq(services.tenantId, context.tenant.id), eq(services.isActive, true))).limit(1);
    if (!branch || !service || (service.branchId && service.branchId !== branch.id)) throw new ApiError("الخدمة أو الفرع غير متاح", 404);
    const depositDueMinor = bookingPolicy.depositRequired ? calculateDepositMinor(service.priceMinor, bookingPolicy.depositPercentBps) : 0;
    const providerRows = await getPublicBookingProviders({ db: context.db, tenantId: context.tenant.id, branchId: branch.id });
    if (!providerRows.length) throw new ApiError("لا يوجد مقدم خدمة متاح للحجز حالياً", 409);
    if (input.providerId && !providerRows.some((provider) => provider.id === input.providerId)) throw new ApiError("مقدم الخدمة غير متاح", 404);
    const requestedProviderId = input.providerId;
    const slots = await getPublicAvailableSlots({ db: context.db, tenantId: context.tenant.id, timezone: context.tenant.timezone, date, branchId: branch.id, durationMinutes: service.durationMinutes, providerIds: providerRows, requestedProviderId });
    const selected = slots.find((slot) => new Date(slot.startsAt).getTime() === start.getTime());
    if (!selected) throw new ApiError("الفترة لم تعد شاغرة أو خارج ساعات العمل؛ اختر وقتاً آخر", 409);

    const now = new Date();
    const [existingCustomer] = await context.db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, context.tenant.id), eq(customers.phone, phone))).limit(1);
    let customerId = existingCustomer?.id;
    let createdCustomer = false;
    if (customerId) {
      await context.db.update(customers).set({ fullName: input.fullName, branchId: branch.id, updatedAt: now }).where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenant.id))).run();
    } else {
      customerId = crypto.randomUUID();
      await context.db.insert(customers).values({ id: customerId, tenantId: context.tenant.id, branchId: branch.id, fullName: input.fullName, phone, email: null, notes: null, gender: "unspecified", createdAt: now, updatedAt: now }).run();
      createdCustomer = true;
    }
    const appointmentId = crypto.randomUUID();
    const publicBookingCode = randomUrlToken(9).toUpperCase();
    const manageToken = randomUrlToken(32);
    const publicManageTokenHash = await hashDigitalTicketToken(manageToken);
    const endsAt = new Date(start.getTime() + service.durationMinutes * 60_000);
    let appointment;
    try {
      [appointment] = await context.db.insert(appointments).values({ id: appointmentId, tenantId: context.tenant.id, branchId: branch.id, customerId, serviceId: service.id, providerId: selected.providerId, startsAt: start, endsAt, status: "pending", source: "public_portal", notes: input.notes?.trim() || null, cancellationReason: null, publicBookingCode, publicManageTokenHash, paymentPreference: input.paymentPreference, whatsappOptIn: input.whatsappConsent, customerResponse: null, customerResponseAt: null, createdBy: null, createdAt: now, updatedAt: now }).returning();
    } catch (error) {
      if (createdCustomer) await context.db.delete(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenant.id))).run();
      if (String(error).includes("APPOINTMENT_PROVIDER_OVERLAP")) throw new ApiError("حُجزت الفترة للتو؛ اختر وقتاً آخر", 409);
      throw error;
    }
    if (!appointment) throw new ApiError("تعذر إنشاء الحجز", 500);
    const ticketToken = await derivePublicDigitalTicketToken(manageToken, context.tenant.id, appointmentId);
    const ticketExpiresAt = digitalTicketExpiresAt(endsAt);
    let packageInvoice: { invoiceNumber: string; totalMinor: number; paidMinor: number; sessions: number; remainingSessions: number; paymentPreference: string } | null = null;
    let bookingInvoice: { invoiceNumber: string; totalMinor: number; paidMinor: number; currency: string; paymentPreference: string } | null = null;
    {
      const invoiceId = crypto.randomUUID();
      const invoiceItemId = crypto.randomUUID();
      const invoiceNumber = `QT-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
        context.db.insert(digitalTickets).values({ id: crypto.randomUUID(), tenantId: context.tenant.id, appointmentId, branchId: branch.id, tokenHash: await hashDigitalTicketToken(ticketToken), status: "issued", issuedAt: now, expiresAt: ticketExpiresAt }),
        context.db.insert(invoices).values({ id: invoiceId, tenantId: context.tenant.id, branchId: branch.id, customerId, appointmentId, issuedBy: null, invoiceNumber, subtotalMinor: service.priceMinor, discountMinor: 0, totalMinor: service.priceMinor, paidMinor: 0, currency: service.currency, paymentMethod: "unpaid", status: "issued", paidAt: null, createdAt: now, updatedAt: now }),
        context.db.insert(invoiceItems).values({ id: invoiceItemId, tenantId: context.tenant.id, invoiceId, serviceId: service.id, providerId: selected.providerId, description: service.name, quantity: 1, unitPriceMinor: service.priceMinor, lineTotalMinor: service.priceMinor, commissionBps: service.providerCommissionBps, createdAt: now }),
      ];
      const sessions = Math.max(1, service.sessionCount);
      if (service.kind !== "single") {
        const entitlementId = crypto.randomUUID();
        const validUntil = service.validityDays ? new Date(now.getTime() + service.validityDays * 86_400_000) : null;
        statements.push(
          context.db.insert(customerEntitlements).values({ id: entitlementId, tenantId: context.tenant.id, customerId, serviceId: service.id, invoiceItemId, totalSessions: sessions, usedSessions: 1, validUntil, status: sessions <= 1 ? "depleted" : "active", createdAt: now, updatedAt: now }),
          context.db.insert(customerEntitlementUsages).values({ id: crypto.randomUUID(), tenantId: context.tenant.id, entitlementId, appointmentId, usedBy: null, usedAt: now }),
        );
      }
      try { await context.db.batch(statements); }
      catch (error) {
        await context.db.delete(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenant.id))).run();
        if (createdCustomer) await context.db.delete(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenant.id))).run();
        throw error;
      }
      bookingInvoice = { invoiceNumber, totalMinor: service.priceMinor, paidMinor: 0, currency: service.currency, paymentPreference: input.paymentPreference };
      if (service.kind !== "single") packageInvoice = { invoiceNumber, totalMinor: service.priceMinor, paidMinor: 0, sessions, remainingSessions: Math.max(0, sessions - 1), paymentPreference: input.paymentPreference };
    }
    let whatsappNotificationsQueued = false;
    if (input.whatsappConsent) {
      try {
        await enqueueBookingNotifications(context.db, { tenantId: context.tenant.id, appointmentId, customerPhone: phone, startsAt: start, endsAt });
        const [confirmation] = await context.db.select({ id: whatsappNotifications.id }).from(whatsappNotifications).where(and(eq(whatsappNotifications.tenantId, context.tenant.id), eq(whatsappNotifications.dedupeKey, `${appointmentId}:confirmation`))).limit(1);
        if (confirmation) await dispatchOneWhatsAppNotification(context.db, getRuntimeEnv(), confirmation.id);
        whatsappNotificationsQueued = Boolean(confirmation);
      } catch { whatsappNotificationsQueued = false; }
    }
    const passPath = `/${encodeURIComponent(context.tenant.slug)}/booking/${encodeURIComponent(publicBookingCode)}`;
    const managePath = `${passPath}?token=${encodeURIComponent(manageToken)}`;
    return Response.json({ booking: { code: publicBookingCode, status: appointment.status, startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(), passPath, managePath, whatsappNotificationsQueued, bookingInvoice, packageInvoice, manualPayment: input.paymentPreference === "electronic_requested" ? publicManualPayment(context.profile) : null, bookingPolicy, depositDueMinor } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("appointments_public_code_uq")) return Response.json({ error: "تعذر إصدار رمز الحجز؛ أعد المحاولة" }, { status: 409 });
    return errorResponse(error);
  }
}
