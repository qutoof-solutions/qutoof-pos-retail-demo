import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { platformAddonRequests, platformBillingRequests, tenants, users } from "@/lib/db/schema";
import { sendAddonReceiptToOwner, sendBillingReceiptToOwner } from "@/lib/platform/telegram";

const CYCLE_LABELS: Record<string, string> = { monthly: "شهرية", quarterly: "ربع سنوية", semi_annual: "نصف سنوية", annual: "سنوية", custom_days: "مدة مخصصة" };
const PAYMENT_LABELS: Record<string, string> = { vodafone_cash: "فودافون كاش", instapay: "إنستاباي" };

export async function dispatchBillingNotifications(limit = 10, onlyRequestId?: string): Promise<{ claimed: number; sent: number; deferred: number }> {
  const env = getRuntimeEnv();
  const db = getDb();
  const now = new Date();
  const pending = await db.select().from(platformBillingRequests).where(and(
    eq(platformBillingRequests.status, "pending_review"),
    isNull(platformBillingRequests.telegramSentAt),
    or(isNull(platformBillingRequests.telegramLeaseUntil), lt(platformBillingRequests.telegramLeaseUntil, now)),
    ...(onlyRequestId ? [eq(platformBillingRequests.id, onlyRequestId)] : []),
  )).orderBy(asc(platformBillingRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 25));
  let claimed = 0;
  let sent = 0;
  let deferred = 0;
  for (const request of pending) {
    const attempt = request.telegramAttempts + 1;
    const leaseUntil = new Date(now.getTime() + 90_000);
    const claim = await db.update(platformBillingRequests).set({ telegramLeaseUntil: leaseUntil, telegramAttempts: attempt, telegramLastError: null, updatedAt: now }).where(and(
      eq(platformBillingRequests.id, request.id), eq(platformBillingRequests.status, "pending_review"), isNull(platformBillingRequests.telegramSentAt),
      or(isNull(platformBillingRequests.telegramLeaseUntil), lt(platformBillingRequests.telegramLeaseUntil, now)),
    )).returning({ id: platformBillingRequests.id });
    if (!claim.length) continue;
    claimed += 1;
    try {
      if (!env.FILES) throw new Error("R2 receipt storage is not configured");
      const [tenant] = await db.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, request.tenantId)).limit(1);
      const [requester] = await db.select({ fullName: users.fullName, email: users.email, phone: users.phone }).from(users).where(and(eq(users.id, request.requestedBy), eq(users.tenantId, request.tenantId))).limit(1);
      const object = await env.FILES.get(request.receiptObjectKey) as unknown as { arrayBuffer(): Promise<ArrayBuffer> } | null;
      if (!tenant || !requester || !object) throw new Error("Tenant, requester, or receipt file is missing");
      const messageId = await sendBillingReceiptToOwner(env, {
        requestId: request.id, tenantName: tenant.name, tenantSlug: tenant.slug,
        requesterName: requester.fullName, requesterEmail: requester.email, requesterPhone: requester.phone,
        planName: request.planNameSnapshot, cycleLabel: CYCLE_LABELS[request.billingCycleSnapshot] ?? request.billingCycleSnapshot,
        paymentMethodLabel: PAYMENT_LABELS[request.paymentMethod] ?? request.paymentMethod,
        amountMinor: request.amountMinor, currency: request.currency,
        receipt: new Uint8Array(await object.arrayBuffer()), receiptContentType: request.receiptContentType, createdAt: request.createdAt,
      });
      await db.update(platformBillingRequests).set({ telegramMessageId: messageId, telegramSentAt: new Date(), telegramLeaseUntil: null, telegramLastError: null, updatedAt: new Date() }).where(and(eq(platformBillingRequests.id, request.id), eq(platformBillingRequests.status, "pending_review"))).run();
      sent += 1;
    } catch (error) {
      const backoffMinutes = attempt >= 8 ? 365 * 24 * 60 : Math.min(240, 2 ** attempt);
      const safeError = error instanceof Error ? error.message.slice(0, 240) : "تعذر إرسال إشعار المراجعة";
      await db.update(platformBillingRequests).set({ telegramLeaseUntil: new Date(Date.now() + backoffMinutes * 60_000), telegramLastError: safeError, updatedAt: new Date() }).where(and(eq(platformBillingRequests.id, request.id), eq(platformBillingRequests.status, "pending_review"))).run();
      deferred += 1;
    }
  }
  return { claimed, sent, deferred };
}

export async function dispatchAddonNotifications(limit = 10, onlyRequestId?: string): Promise<{ claimed: number; sent: number; deferred: number }> {
  const env = getRuntimeEnv();
  const db = getDb();
  const now = new Date();
  const pending = await db.select().from(platformAddonRequests).where(and(
    eq(platformAddonRequests.status, "pending_review"),
    isNull(platformAddonRequests.telegramSentAt),
    or(isNull(platformAddonRequests.telegramLeaseUntil), lt(platformAddonRequests.telegramLeaseUntil, now)),
    ...(onlyRequestId ? [eq(platformAddonRequests.id, onlyRequestId)] : []),
  )).orderBy(asc(platformAddonRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 25));
  let claimed = 0;
  let sent = 0;
  let deferred = 0;
  for (const request of pending) {
    const attempt = request.telegramAttempts + 1;
    const leaseUntil = new Date(now.getTime() + 90_000);
    const claim = await db.update(platformAddonRequests).set({ telegramLeaseUntil: leaseUntil, telegramAttempts: attempt, telegramLastError: null, updatedAt: now }).where(and(
      eq(platformAddonRequests.id, request.id), eq(platformAddonRequests.status, "pending_review"), isNull(platformAddonRequests.telegramSentAt),
      or(isNull(platformAddonRequests.telegramLeaseUntil), lt(platformAddonRequests.telegramLeaseUntil, now)),
    )).returning({ id: platformAddonRequests.id });
    if (!claim.length) continue;
    claimed += 1;
    try {
      if (!env.FILES) throw new Error("R2 receipt storage is not configured");
      const [tenant] = await db.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, request.tenantId)).limit(1);
      const [requester] = await db.select({ fullName: users.fullName, email: users.email, phone: users.phone }).from(users).where(and(eq(users.id, request.requestedBy), eq(users.tenantId, request.tenantId))).limit(1);
      const object = await env.FILES.get(request.receiptObjectKey) as unknown as { arrayBuffer(): Promise<ArrayBuffer> } | null;
      if (!tenant || !requester || !object) throw new Error("Tenant, requester, or addon receipt file is missing");
      const messageId = await sendAddonReceiptToOwner(env, {
        requestId: request.id, tenantName: tenant.name, tenantSlug: tenant.slug,
        requesterName: requester.fullName, requesterEmail: requester.email, requesterPhone: requester.phone,
        addonName: `${request.addonNameSnapshot} (${request.resourceType})`, quantity: request.quantity,
        paymentMethodLabel: PAYMENT_LABELS[request.paymentMethod] ?? request.paymentMethod,
        amountMinor: request.amountMinor, currency: request.currency,
        subscriptionEndsAt: request.subscriptionEndSnapshot, receipt: new Uint8Array(await object.arrayBuffer()),
        receiptContentType: request.receiptContentType, createdAt: request.createdAt,
      });
      await db.update(platformAddonRequests).set({ telegramMessageId: messageId, telegramSentAt: new Date(), telegramLeaseUntil: null, telegramLastError: null, updatedAt: new Date() }).where(and(eq(platformAddonRequests.id, request.id), eq(platformAddonRequests.status, "pending_review"))).run();
      sent += 1;
    } catch (error) {
      const backoffMinutes = attempt >= 8 ? 365 * 24 * 60 : Math.min(240, 2 ** attempt);
      const safeError = error instanceof Error ? error.message.slice(0, 240) : "تعذر إرسال إشعار الإضافة";
      await db.update(platformAddonRequests).set({ telegramLeaseUntil: new Date(Date.now() + backoffMinutes * 60_000), telegramLastError: safeError, updatedAt: new Date() }).where(and(eq(platformAddonRequests.id, request.id), eq(platformAddonRequests.status, "pending_review"))).run();
      deferred += 1;
    }
  }
  return { claimed, sent, deferred };
}
