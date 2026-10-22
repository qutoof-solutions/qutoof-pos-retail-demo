import { and, eq, inArray } from "drizzle-orm";
import type { OperationContext } from "@/lib/server/operations";
import { ApiError } from "@/lib/server/operations";
import { appointments, branchMemberships, branches, customers, inventoryWarehouses } from "@/lib/db/schema";

/** Return only active branches explicitly assigned to the authenticated user. */
export async function getAccessibleBranchIds(context: OperationContext): Promise<string[]> {
  const rows = await context.db
    .select({ branchId: branchMemberships.branchId })
    .from(branchMemberships)
    .innerJoin(branches, and(
      eq(branches.id, branchMemberships.branchId),
      eq(branches.tenantId, branchMemberships.tenantId),
      eq(branches.isActive, true),
    ))
    .where(and(
      eq(branchMemberships.tenantId, context.tenantId),
      eq(branchMemberships.userId, context.user.id),
    ));
  return rows.map((row) => row.branchId);
}

/** Rejects a caller-selected branch unless the server confirms active membership. */
export async function requireBranchMembership(context: OperationContext, branchId: string | null | undefined): Promise<void> {
  if (!branchId) throw new ApiError("حدد فرعًا صالحًا للعملية", 403);
  const [membership] = await context.db
    .select({ branchId: branchMemberships.branchId })
    .from(branchMemberships)
    .innerJoin(branches, and(
      eq(branches.id, branchMemberships.branchId),
      eq(branches.tenantId, branchMemberships.tenantId),
      eq(branches.isActive, true),
    ))
    .where(and(
      eq(branchMemberships.tenantId, context.tenantId),
      eq(branchMemberships.userId, context.user.id),
      eq(branchMemberships.branchId, branchId),
    ))
    .limit(1);
  if (!membership) throw new ApiError("لا تملك صلاحية الوصول إلى هذا الفرع", 403);
}

export type CustomerBranchScope = {
  customerBranchId: string | null;
  accessibleBranchIds: string[];
  appointmentIds: string[];
};

/** Resolve branch scope for a customer. Branchless legacy customers are usable only when they have an appointment in an assigned branch. */
export async function getCustomerBranchScope(context: OperationContext, customerId: string): Promise<CustomerBranchScope> {
  const [customer] = await context.db.select({ id: customers.id, branchId: customers.branchId })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId)))
    .limit(1);
  if (!customer) throw new ApiError("العميل غير موجود", 404);
  const accessibleBranchIds = await getAccessibleBranchIds(context);
  if (!accessibleBranchIds.length) throw new ApiError("العميل غير موجود", 404);
  const visits = await context.db.select({ id: appointments.id })
    .from(appointments)
    .where(and(
      eq(appointments.tenantId, context.tenantId),
      eq(appointments.customerId, customerId),
      inArray(appointments.branchId, accessibleBranchIds),
    ));
  const customerBranchAccessible = customer.branchId !== null && accessibleBranchIds.includes(customer.branchId);
  if (!customerBranchAccessible && !visits.length) throw new ApiError("العميل غير موجود", 404);
  return { customerBranchId: customer.branchId, accessibleBranchIds, appointmentIds: visits.map((visit) => visit.id) };
}

/** Require memberships for every active tenant branch before exposing a tenant-wide resource. */
export async function requireAllActiveBranchMemberships(context: OperationContext): Promise<string[]> {
  const active = await context.db.select({ id: branches.id }).from(branches)
    .where(and(eq(branches.tenantId, context.tenantId), eq(branches.isActive, true)));
  const accessible = await getAccessibleBranchIds(context);
  if (!active.length || active.some((branch) => !accessible.includes(branch.id))) {
    throw new ApiError("تتطلب هذه العملية عضوية في جميع الفروع النشطة", 403);
  }
  return accessible;
}

/** Return only warehouses that are branch-scoped to the user; shared (NULL branch) warehouses require all active branch memberships. */
export async function getAccessibleWarehouseIds(context: OperationContext): Promise<string[]> {
  const [branchIds, warehouseRows] = await Promise.all([
    getAccessibleBranchIds(context),
    context.db.select({ id: inventoryWarehouses.id, branchId: inventoryWarehouses.branchId })
      .from(inventoryWarehouses)
      .where(eq(inventoryWarehouses.tenantId, context.tenantId)),
  ]);
  const allBranchIds = await context.db.select({ id: branches.id }).from(branches)
    .where(and(eq(branches.tenantId, context.tenantId), eq(branches.isActive, true)));
  const hasAllBranches = allBranchIds.length > 0 && allBranchIds.every((branch) => branchIds.includes(branch.id));
  return warehouseRows.filter((warehouse) => warehouse.branchId ? branchIds.includes(warehouse.branchId) : hasAllBranches).map((warehouse) => warehouse.id);
}

export async function requireWarehouseBranchMembership(context: OperationContext, branchId: string | null): Promise<void> {
  if (branchId) {
    await requireBranchMembership(context, branchId);
    return;
  }
  await requireAllActiveBranchMemberships(context);
}
