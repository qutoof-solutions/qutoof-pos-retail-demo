import test from "node:test";
import assert from "node:assert/strict";
import { findUnitByBarcode, maxSellableQuantity, resolveCustomerPriceTier, unitTierPrice, baseQuantity, displayConversionFactor } from "@/lib/operations/uom";

test("scanning a major-unit barcode resolves the configured unit", () => {
  const unit = findUnitByBarcode([{ id: "case", barcode: "6299999999999" }, { id: "dozen", barcode: "6299999999998" }], "6299999999999");
  assert.equal(unit?.id, "case");
});

test("customer price tier is applied automatically and selects the matching unit price", () => {
  assert.equal(resolveCustomerPriceTier("wholesale"), "wholesale");
  const item = { id: "base", code: "piece", name: "قطعة", conversionFactor: 1, sellingPriceMinor: 100, wholesalePriceMinor: 85, distributorPriceMinor: 75 };
  assert.equal(unitTierPrice(item, item, "wholesale"), 85);
  assert.equal(unitTierPrice(item, item, "distributor"), 75);
});

test("composite-unit transfer converts dozen quantities to base units and caps stock", () => {
  assert.equal(baseQuantity(3, 12, 0), 36);
  assert.equal(maxSellableQuantity(60, 0, 12), 5);
});

test("inventory unit DTO keeps the scaled factor for writes and exposes a human display factor", () => {
  for (const [quantityScale, conversionFactor, expectedDisplay] of [[0, 12, 12], [2, 1250, 12.5], [4, 125000, 12.5]] as const) {
    const dto = displayConversionFactor({ id: "case", conversionFactor }, quantityScale);
    assert.equal(dto.conversionFactor, conversionFactor);
    assert.equal(dto.displayConversionFactor, expectedDisplay);
    const scaledBaseQuantity = baseQuantity(2, dto.conversionFactor, quantityScale);
    assert.equal(scaledBaseQuantity, expectedDisplay * 2 * (10 ** quantityScale));
    assert.equal(scaledBaseQuantity / (10 ** quantityScale), expectedDisplay * 2);
  }
});
