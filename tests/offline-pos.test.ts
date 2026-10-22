import assert from "node:assert/strict";
import { test } from "node:test";
import { signOfflinePrice, verifyOfflinePrice, type OfflinePriceClaims } from "../lib/operations/offline-price";
import { splitOfflineStock } from "../lib/operations/offline-stock";

const secret = "offline-test-secret-with-more-than-32-characters";
const claim: OfflinePriceClaims = {
  tenantId: "tenant-1",
  itemType: "inventory",
  itemId: "item-1",
  branchId: "branch-1",
  unitPriceMinor: 12500,
  issuedAt: 1_797_000_000_000,
};

test("signed offline prices verify only for the exact cached tenant, item, branch and amount", async () => {
  const token = await signOfflinePrice(secret, claim);
  assert.equal(await verifyOfflinePrice(secret, token, {
    tenantId: claim.tenantId,
    itemType: claim.itemType,
    itemId: claim.itemId,
    branchId: claim.branchId,
    unitPriceMinor: claim.unitPriceMinor,
  }), true);
  assert.equal(await verifyOfflinePrice(secret, token, { ...claim, unitPriceMinor: claim.unitPriceMinor + 1 }), false);
  assert.equal(await verifyOfflinePrice(secret, token, { ...claim, tenantId: "another-tenant" }), false);
  assert.equal(await verifyOfflinePrice(`${secret}-wrong`, token, claim), false);
});

test("shared services can use a signed price in any branch, but branch-specific entries cannot be replayed across branches", async () => {
  const sharedToken = await signOfflinePrice(secret, { ...claim, itemType: "service", branchId: null });
  assert.equal(await verifyOfflinePrice(secret, sharedToken, { ...claim, itemType: "service", branchId: "branch-2" }), true);
  const branchToken = await signOfflinePrice(secret, { ...claim, itemType: "service", branchId: "branch-1" });
  assert.equal(await verifyOfflinePrice(secret, branchToken, { ...claim, itemType: "service", branchId: "branch-2" }), false);
});

test("offline sales allocate no more than current stock and retain a precise shortage", () => {
  assert.deepEqual(splitOfflineStock(7, 4), { requested: 7, allocated: 4, shortage: 3 });
  assert.deepEqual(splitOfflineStock(3, 8), { requested: 3, allocated: 3, shortage: 0 });
  assert.deepEqual(splitOfflineStock(2, 0), { requested: 2, allocated: 0, shortage: 2 });
  assert.throws(() => splitOfflineStock(1.5, 1), /أعداداً صحيحة/);
});
