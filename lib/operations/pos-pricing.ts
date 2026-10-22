import type { PriceTier } from "@/components/operations/pos-types";

export type TieredPrice = {
  sellingPriceMinor: number;
  wholesalePriceMinor: number;
  distributorPriceMinor: number;
};

export function getTierPriceMinor(product: TieredPrice | null | undefined, tier: PriceTier): number {
  if (!product) return 0;
  if (tier === "wholesale") return product.wholesalePriceMinor;
  if (tier === "distributor") return product.distributorPriceMinor;
  return product.sellingPriceMinor;
}
