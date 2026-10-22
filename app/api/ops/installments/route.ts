import { and, asc, eq, inArray } from "drizzle-orm";
import { branches, customers, installmentContracts, installmentSchedules, invoices } from "@/lib/db/schema";
import { errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId")?.trim() || null;
    const accessible = await getAccessibleBranchIds(access.context);
    if (!accessible.length) return Response.json({ contracts: [], dueThisMonth: [], overdue: [] }, { headers: { "Cache-Control": "no-store" } });
    if (branchId) {
      if (!uuidSchema.safeParse(branchId).success) return Response.json({ error: "معرف الفرع غير صالح" }, { status: 400 });
      await requireBranchMembership(access.context, branchId);
    }
    const branchIds = branchId ? [branchId] : accessible;
    const rows = await access.context.db.select({ schedule: installmentSchedules, contract: installmentContracts, invoiceNumber: invoices.invoiceNumber, customerName: customers.fullName, customerPhone: customers.phone, branchName: branches.name, branchNameAr: branches.nameAr, branchNameEn: branches.nameEn }).from(installmentSchedules)
      .innerJoin(installmentContracts, and(eq(installmentContracts.id, installmentSchedules.contractId), eq(installmentContracts.tenantId, access.context.tenantId)))
      .innerJoin(invoices, and(eq(invoices.id, installmentSchedules.invoiceId), eq(invoices.tenantId, access.context.tenantId)))
      .leftJoin(customers, and(eq(customers.id, installmentContracts.customerId), eq(customers.tenantId, access.context.tenantId)))
      .leftJoin(branches, and(eq(branches.id, installmentContracts.branchId), eq(branches.tenantId, access.context.tenantId)))
      .where(and(eq(installmentSchedules.tenantId, access.context.tenantId), eq(installmentSchedules.status, "unpaid"), inArray(installmentContracts.branchId, branchIds)))
      .orderBy(asc(installmentSchedules.dueAt)).limit(500);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const mapped = rows.map((row) => ({ ...row.schedule, contractId: row.contract.id, invoiceNumber: row.invoiceNumber, customerName: row.customerName, customerPhone: row.customerPhone, branchName: row.branchName, remainingMinor: row.schedule.amountMinor - row.schedule.paidMinor }));
    return Response.json({ contracts: [...new Map(rows.map((row) => [row.contract.id, { ...row.contract, invoiceNumber: row.invoiceNumber, customerName: row.customerName, branchName: row.branchName, branchNameAr: row.branchNameAr, branchNameEn: row.branchNameEn }])).values()], dueThisMonth: mapped.filter((row) => row.dueAt >= monthStart && row.dueAt < nextMonth), overdue: mapped.filter((row) => row.dueAt < now) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "تعذر تحميل جدول الأقساط");
  }
}
