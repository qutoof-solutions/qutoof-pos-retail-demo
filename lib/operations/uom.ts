import type { PriceTier } from "@/components/operations/pos-types";

export type UnitPrice = {
  id: string;
  code: string;
  name: string;
  conversionFactor: number;
  barcode?: string | null;
  sellingPriceMinor: number;
  wholesalePriceMinor: number;
  distributorPriceMinor: number;
};

export function unitFactor(conversionFactor: number, quantityScale: number): number {
  return conversionFactor / (10 ** quantityScale);
}

export function displayConversionFactor<T extends { conversionFactor: number }>(unit: T, quantityScale: number): T & { displayConversionFactor: number } {
  return { ...unit, displayConversionFactor: unitFactor(unit.conversionFactor, quantityScale) };
}

export function baseQuantity(quantity: number, conversionFactor: number, quantityScale: number): number {
  const result = Math.round(quantity * unitFactor(conversionFactor, quantityScale) * (10 ** quantityScale));
  if (!Number.isSafeInteger(result) || result < 1) throw new RangeError("كمية الوحدة غير صالحة");
  return result;
}

export function unitTierPrice(unit: UnitPrice | null | undefined, fallback: UnitPrice, tier: PriceTier): number {
  const source = unit ?? fallback;
  if (tier === "wholesale") return source.wholesalePriceMinor;
  if (tier === "distributor") return source.distributorPriceMinor;
  return source.sellingPriceMinor;
}

export function findUnitByBarcode<T extends { barcode?: string | null }>(units: T[] | undefined, barcode: string): T | null {
  return units?.find((unit) => unit.barcode === barcode) ?? null;
}

export function resolveCustomerPriceTier(customerTier: PriceTier | null | undefined, fallback: PriceTier = "retail"): PriceTier {
  return customerTier ?? fallback;
}

export function maxSellableQuantity(quantityOnHand: number, quantityScale: number, conversionFactor: number): number {
  return quantityOnHand / (10 ** quantityScale) / unitFactor(conversionFactor, quantityScale);
}
