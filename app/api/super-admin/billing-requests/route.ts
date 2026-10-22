import { desc, eq, sql } from "drizzle-orm";
import { platformAddonRequests, platformBillingRequests } from "@/lib/db/schema";
import { resourceAddonLabel } from "@/lib/platform/addon-entitlements";
import { requireSuperAdminAccess } from "@/lib/server/super-admin";

export const runtime = "edge";
const VALID_STATUSES = ["pending_review", "approved", "rejected", "cancelled", "expired"] as const;

export async function GET(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;
  const status = new URL(request.url).searchParams.get("status");
  const baseWhere = status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number]) && status !== "expired" ? eq(platformBillingRequests.status, status as "pending_review" | "approved" | "rejected" | "cancelled") : undefined;
  const addonWhere = status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number]) ? eq(platformAddonRequests.status, status as (typeof VALID_STATUSES)[number]) : undefined;
  const [baseRows, addonRows] = await Promise.all([
    access.context.db.select({
      id: platformBillingRequests.id, tenantId: platformBillingRequests.tenantId,
      tenantName: sql<string | null>`(SELECT name FROM tenants WHERE id = ${platformBillingRequests.tenantId})`,
      tenantSlug: sql<string | null>`(SELECT slug FROM tenants WHERE id = ${platformBillingRequests.tenantId})`,
      planName: platformBillingRequests.planNameSnapshot, billingCycle: platformBillingRequests.billingCycleSnapshot,
      amountMinor: platformBillingRequests.amountMinor, currency: platformBillingRequests.currency, paymentMethod: platformBillingRequests.paymentMethod,
      status: platformBillingRequests.status, rejectionReason: platformBillingRequests.rejectionReason,
      telegramMessageId: platformBillingRequests.telegramMessageId, telegramSentAt: platformBillingRequests.telegramSentAt,
      telegramAttempts: platformBillingRequests.telegramAttempts, telegramLastError: platformBillingRequests.telegramLastError,
      createdAt: platformBillingRequests.createdAt, reviewedAt: platformBillingRequests.reviewedAt,
    }).from(platformBillingRequests).where(baseWhere).orderBy(desc(platformBillingRequests.createdAt)).limit(100),
    access.context.db.select({
      id: platformAddonRequests.id, tenantId: platformAddonRequests.tenantId,
      tenantName: sql<string | null>`(SELECT name FROM tenants WHERE id = ${platformAddonRequests.tenantId})`,
      tenantSlug: sql<string | null>`(SELECT slug FROM tenants WHERE id = ${platformAddonRequests.tenantId})`,
      addonName: platformAddonRequests.addonNameSnapshot, resourceType: platformAddonRequests.resourceType, quantity: platformAddonRequests.quantity,
      billingCycle: platformAddonRequests.billingCycleSnapshot, amountMinor: platformAddonRequests.amountMinor, currency: platformAddonRequests.currency,
      paymentMethod: platformAddonRequests.paymentMethod, status: platformAddonRequests.status, rejectionReason: platformAddonRequests.rejectionReason,
      telegramMessageId: platformAddonRequests.telegramMessageId, telegramSentAt: platformAddonRequests.telegramSentAt,
      telegramAttempts: platformAddonRequests.telegramAttempts, telegramLastError: platformAddonRequests.telegramLastError,
      createdAt: platformAddonRequests.createdAt, reviewedAt: platformAddonRequests.reviewedAt, invoiceNumber: platformAddonRequests.invoiceNumber,
      subscriptionEnd: platformAddonRequests.subscriptionEndSnapshot,
    }).from(platformAddonRequests).where(addonWhere).orderBy(desc(platformAddonRequests.createdAt)).limit(100),
  ]);
  const requests = [
    ...baseRows.map((row) => ({ ...row, requestKind: "subscription" as const, receiptUrl: `/api/super-admin/billing-requests/${row.id}/receipt`, telegramStatus: row.telegramSentAt ? "sent" : row.status === "pending_review" ? "queued" : "not_required" })),
    ...addonRows.map((row) => ({
      id: row.id, tenantId: row.tenantId, tenantName: row.tenantName, tenantSlug: row.tenantSlug,
      planName: `${resourceAddonLabel(row.resourceType)} · ${row.quantity}`, billingCycle: row.billingCycle,
      amountMinor: row.amountMinor, currency: row.currency, paymentMethod: row.paymentMethod, status: row.status,
      rejectionReason: row.rejectionReason, telegramMessageId: row.telegramMessageId, telegramSentAt: row.telegramSentAt,
      telegramAttempts: row.telegramAttempts, telegramLastError: row.telegramLastError, createdAt: row.createdAt,
      reviewedAt: row.reviewedAt, requestKind: "addon" as const, resourceType: row.resourceType, quantity: row.quantity,
      addonName: row.addonName, invoiceNumber: row.invoiceNumber, subscriptionEnd: row.subscriptionEnd,
      receiptUrl: `/api/super-admin/addon-requests/${row.id}/receipt`, telegramStatus: row.telegramSentAt ? "sent" : row.status === "pending_review" ? "queued" : "not_required",
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
  return Response.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}
