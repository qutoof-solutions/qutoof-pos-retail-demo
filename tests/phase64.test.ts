import assert from "node:assert/strict";
import test from "node:test";
import { buildEan13CheckDigit, parseWeightedScaleBarcode } from "../lib/operations/weighted-scale-barcode";
import { discountMinorForPoints, pointsEarnedForPurchase } from "../lib/operations/loyalty";

test("weighted scale barcode extracts PLU and decimal kilograms", () => {
  const body = "201234500125";
  const barcode = body + buildEan13CheckDigit(body);
  assert.deepEqual(parseWeightedScaleBarcode(barcode), {
    raw: barcode, prefix: "20", itemCode: "12345", value: 125, valueDigits: "00125", mode: "weight", quantity: 0.125, quantityScale: 3, priceMinor: null,
  });
});

test("weighted scale parser rejects ordinary or invalid EAN values and supports price mode", () => {
  assert.equal(parseWeightedScaleBarcode("1234567890128"), null);
  assert.equal(parseWeightedScaleBarcode("2012345001250"), null);
  const body = "211234500499";
  const barcode = body + buildEan13CheckDigit(body);
  const parsed = parseWeightedScaleBarcode(barcode, { mode: "price" });
  assert.equal(parsed?.itemCode, "12345");
  assert.equal(parsed?.priceMinor, 499);
  assert.equal(parsed?.quantity, null);
});

test("loyalty awards one point per ten EGP and redeems at ten piasters", () => {
  assert.equal(pointsEarnedForPurchase(999), 0);
  assert.equal(pointsEarnedForPurchase(1000), 1);
  assert.equal(pointsEarnedForPurchase(12500), 12);
  assert.equal(discountMinorForPoints(12), 120);
  assert.throws(() => discountMinorForPoints(-1), RangeError);
});
