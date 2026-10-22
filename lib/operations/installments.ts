export type InstallmentFrequency = "weekly" | "monthly";

export type InstallmentPlan = {
  baseTotalMinor: number;
  downPaymentMinor: number;
  interestBps: number;
  adminFeeMinor: number;
  interestFeeMinor: number;
  totalDueMinor: number;
  financedMinor: number;
  amountsMinor: number[];
  dueAt: Date[];
};

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function buildInstallmentPlan(input: {
  baseTotalMinor: number;
  downPaymentMinor: number;
  interestBps: number;
  adminFeeMinor: number;
  installmentCount: number;
  frequency: InstallmentFrequency;
  firstDueAt: Date;
}): InstallmentPlan {
  const { baseTotalMinor, downPaymentMinor, interestBps, adminFeeMinor, installmentCount, frequency, firstDueAt } = input;
  if (!Number.isSafeInteger(baseTotalMinor) || baseTotalMinor < 1) throw new RangeError("إجمالي الفاتورة غير صالح");
  if (!Number.isSafeInteger(downPaymentMinor) || downPaymentMinor < 0 || downPaymentMinor > baseTotalMinor) throw new RangeError("الدفعة المقدمة يجب ألا تتجاوز إجمالي الفاتورة");
  if (!Number.isInteger(interestBps) || interestBps < 0 || interestBps > 100_000) throw new RangeError("نسبة الفائدة غير صالحة");
  if (!Number.isSafeInteger(adminFeeMinor) || adminFeeMinor < 0) throw new RangeError("الرسوم الإدارية غير صالحة");
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60) throw new RangeError("عدد الأقساط يجب أن يكون بين 1 و60");
  if (!(firstDueAt instanceof Date) || Number.isNaN(firstDueAt.getTime())) throw new RangeError("تاريخ أول قسط غير صالح");

  const interestFeeMinor = Math.round((baseTotalMinor - downPaymentMinor) * interestBps / 10_000);
  const totalDueMinor = baseTotalMinor + interestFeeMinor + adminFeeMinor;
  const financedMinor = totalDueMinor - downPaymentMinor;
  if (financedMinor < installmentCount) throw new RangeError("المبلغ المتبقي لا يكفي لعدد الأقساط");

  const baseAmount = Math.floor(financedMinor / installmentCount);
  const remainder = financedMinor - baseAmount * installmentCount;
  const amountsMinor = Array.from({ length: installmentCount }, (_, index) => baseAmount + (index < remainder ? 1 : 0));
  const dueAt = amountsMinor.map((_, index) => frequency === "weekly" ? new Date(firstDueAt.getTime() + index * 7 * 86_400_000) : addMonths(firstDueAt, index));
  return { baseTotalMinor, downPaymentMinor, interestBps, adminFeeMinor, interestFeeMinor, totalDueMinor, financedMinor, amountsMinor, dueAt };
}
