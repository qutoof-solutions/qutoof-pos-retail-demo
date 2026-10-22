import assert from "node:assert/strict";
import test from "node:test";
import { ensureBusinessAdminBranchMembership, type WorkspaceMembershipStore } from "../lib/server/workspace-membership";

function createStore(options: { hasMembership?: boolean; branchId?: string | null } = {}) {
  const calls: string[] = [];
  let member = options.hasMembership ?? false;
  const store: WorkspaceMembershipStore = {
    hasMembership: async (tenantId, userId) => {
      calls.push(`has:${tenantId}:${userId}`);
      return member;
    },
    findFirstActiveBranch: async (tenantId) => {
      calls.push(`branch:${tenantId}`);
      return options.branchId === undefined ? "branch-main" : options.branchId;
    },
    addMembership: async (tenantId, userId, branchId) => {
      calls.push(`add:${tenantId}:${userId}:${branchId}`);
      member = true;
    },
  };
  return { store, calls, isMember: () => member };
}

test("self-heal attaches an existing business administrator to the selected active tenant branch", async () => {
  const { store, calls, isMember } = createStore({ branchId: "active-primary" });
  const result = await ensureBusinessAdminBranchMembership({ id: "owner-1", tenantId: "tenant-1", role: "business_admin" }, store);

  assert.equal(result, "membership_repaired");
  assert.equal(isMember(), true);
  assert.deepEqual(calls, ["has:tenant-1:owner-1", "branch:tenant-1", "add:tenant-1:owner-1:active-primary"]);
});

test("self-heal is idempotent when the administrator already has any tenant membership", async () => {
  const { store, calls } = createStore({ hasMembership: true });
  const result = await ensureBusinessAdminBranchMembership({ id: "owner-1", tenantId: "tenant-1", role: "owner" }, store);

  assert.equal(result, "already_member");
  assert.deepEqual(calls, ["has:tenant-1:owner-1"]);
});

test("self-heal never escalates staff or cross-tenant identities", async () => {
  const { store, calls } = createStore();
  const staffResult = await ensureBusinessAdminBranchMembership({ id: "doctor-1", tenantId: "tenant-1", role: "doctor" }, store);
  const noTenantResult = await ensureBusinessAdminBranchMembership({ id: "orphan-1", tenantId: null, role: "admin" }, store);

  assert.equal(staffResult, "not_eligible");
  assert.equal(noTenantResult, "not_eligible");
  assert.deepEqual(calls, []);
});

test("self-heal is safe when the tenant has no active branch", async () => {
  const { store, calls, isMember } = createStore({ branchId: null });
  const result = await ensureBusinessAdminBranchMembership({ id: "owner-1", tenantId: "tenant-1", role: "admin" }, store);

  assert.equal(result, "no_active_branch");
  assert.equal(isMember(), false);
  assert.deepEqual(calls, ["has:tenant-1:owner-1", "branch:tenant-1"]);
});
