import { and, asc, eq } from "drizzle-orm";
import type { AuthRole } from "@/lib/auth";
import { isBusinessAdminRole } from "@/lib/operations/permissions";

export type WorkspaceIdentity = { id: string; tenantId: string | null; role: AuthRole };
export type MembershipRepairResult = "not_eligible" | "already_member" | "membership_repaired" | "no_active_branch";

export type WorkspaceMembershipStore = {
  hasMembership: (tenantId: string, userId: string) => Promise<boolean>;
  findFirstActiveBranch: (tenantId: string) => Promise<string | null>;
  addMembership: (tenantId: string, userId: string, branchId: string) => Promise<void>;
};

export async function ensureBusinessAdminBranchMembership(
  user: WorkspaceIdentity,
  store: WorkspaceMembershipStore,
): Promise<MembershipRepairResult> {
  if (!user.tenantId || !isBusinessAdminRole(user.role)) return "not_eligible";
  if (await store.hasMembership(user.tenantId, user.id)) return "already_member";

  const branchId = await store.findFirstActiveBranch(user.tenantId);
  if (!branchId) return "no_active_branch";

  await store.addMembership(user.tenantId, user.id, branchId);
  return "membership_repaired";
}

export async function repairBusinessAdminWorkspaceMembership(user: WorkspaceIdentity): Promise<MembershipRepairResult> {
  const [{ getDb }, { branchMemberships, branches }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/schema"),
  ]);
  const db = getDb();
  return ensureBusinessAdminBranchMembership(user, {
    hasMembership: async (tenantId, userId) => {
      const [membership] = await db.select({ id: branchMemberships.id })
        .from(branchMemberships)
        .where(and(eq(branchMemberships.tenantId, tenantId), eq(branchMemberships.userId, userId)))
        .limit(1);
      return Boolean(membership);
    },
    findFirstActiveBranch: async (tenantId) => {
      const [branch] = await db.select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
        .orderBy(asc(branches.createdAt), asc(branches.id))
        .limit(1);
      return branch?.id ?? null;
    },
    addMembership: async (tenantId, userId, branchId) => {
      await db.insert(branchMemberships)
        .values({ id: crypto.randomUUID(), tenantId, userId, branchId, createdAt: new Date() })
        .onConflictDoNothing()
        .run();
    },
  });
}
