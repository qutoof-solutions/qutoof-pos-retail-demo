export type OfflineStockSplit = { requested: number; allocated: number; shortage: number };

export function splitOfflineStock(requested: number, available: number): OfflineStockSplit {
  if (!Number.isSafeInteger(requested) || requested < 0 || !Number.isSafeInteger(available) || available < 0) {
    throw new Error("كميات المخزون يجب أن تكون أعداداً صحيحة غير سالبة");
  }
  const allocated = Math.min(requested, available);
  return { requested, allocated, shortage: requested - allocated };
}
