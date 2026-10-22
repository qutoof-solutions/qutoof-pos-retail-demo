export const splitPaymentMethods = ["cash", "card", "wallet", "instapay"] as const;

export type SplitPaymentMethod = (typeof splitPaymentMethods)[number];

export type PaymentLineMinor = {
  amountMinor: number;
  paymentMethod: SplitPaymentMethod;
};

export type PaymentSummary = {
  totalMinor: number;
  byMethod: Record<SplitPaymentMethod, number>;
  remainingMinor: number;
  overpaymentMinor: number;
  isFullyPaid: boolean;
};

export function summarizePayments(lines: PaymentLineMinor[], invoiceTotalMinor: number): PaymentSummary {
  if (!Number.isSafeInteger(invoiceTotalMinor) || invoiceTotalMinor < 0) {
    throw new RangeError("إجمالي الفاتورة غير صالح");
  }

  const byMethod: Record<SplitPaymentMethod, number> = { cash: 0, card: 0, wallet: 0, instapay: 0 };
  for (const line of lines) {
    if (!splitPaymentMethods.includes(line.paymentMethod) || !Number.isSafeInteger(line.amountMinor) || line.amountMinor < 1) {
      throw new RangeError("مبلغ أو طريقة دفع غير صالحة");
    }
    byMethod[line.paymentMethod] += line.amountMinor;
  }

  const totalMinor = Object.values(byMethod).reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(totalMinor)) throw new RangeError("مجموع الدفعات يتجاوز الحد المسموح");
  const remainingMinor = Math.max(invoiceTotalMinor - totalMinor, 0);
  const overpaymentMinor = Math.max(totalMinor - invoiceTotalMinor, 0);

  return { totalMinor, byMethod, remainingMinor, overpaymentMinor, isFullyPaid: totalMinor >= invoiceTotalMinor };
}
