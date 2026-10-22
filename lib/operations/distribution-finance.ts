export type SettlementQuantities = {
  loadedUnits: number;
  soldUnits: number;
  returnedGoodUnits: number;
  returnedDamagedUnits: number;
  missingUnits: number;
};

export type ProfitInputs = {
  salesMinor: number;
  cogsMinor: number;
  operatingExpensesMinor: number;
  commissionBps?: number;
};

export type ProfitSummary = ProfitInputs & {
  commissionMinor: number;
  grossProfitMinor: number;
  netProfitMinor: number;
};

export function validateTripSettlement(row: SettlementQuantities): void {
  const values = [row.loadedUnits, row.soldUnits, row.returnedGoodUnits, row.returnedDamagedUnits, row.missingUnits];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || row.loadedUnits < 1) {
    throw new RangeError("كميات التسوية يجب أن تكون وحدات صحيحة غير سالبة");
  }
  const accounted = row.soldUnits + row.returnedGoodUnits + row.returnedDamagedUnits + row.missingUnits;
  if (!Number.isSafeInteger(accounted) || accounted !== row.loadedUnits) {
    throw new RangeError("يجب أن يساوي المباع والمرتجع السليم والتالف والعجز إجمالي الكمية المحملة");
  }
}

export function calculateProfit(inputs: ProfitInputs): ProfitSummary {
  const commissionBps = inputs.commissionBps ?? 0;
  for (const amount of [inputs.salesMinor, inputs.cogsMinor, commissionBps]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("القيم المحاسبية يجب أن تكون أعداداً صحيحة غير سالبة");
  }
  if (!Number.isSafeInteger(inputs.operatingExpensesMinor)) throw new RangeError("صافي المصروفات يجب أن يكون عدداً صحيحاً من القروش");
  if (commissionBps > 10_000) throw new RangeError("نسبة العمولة يجب ألا تتجاوز 100%");
  const commissionMinor = Math.round((inputs.salesMinor * commissionBps) / 10_000);
  const grossProfitMinor = inputs.salesMinor - inputs.cogsMinor;
  return {
    ...inputs,
    commissionBps,
    commissionMinor,
    grossProfitMinor,
    netProfitMinor: grossProfitMinor - inputs.operatingExpensesMinor - commissionMinor,
  };
}

export function cashDifference(expectedMinor: number, handedMinor: number): number {
  if (![expectedMinor, handedMinor].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError("مبالغ النقدية يجب أن تكون قروشاً صحيحة غير سالبة");
  }
  return handedMinor - expectedMinor;
}
