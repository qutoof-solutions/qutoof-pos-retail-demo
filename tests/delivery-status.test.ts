import assert from "node:assert/strict";
import test from "node:test";
import { DELIVERY_STATUS_VALUES, deliveryStatusBodySchema, deliveryStatusOptions, deliveryStatusPayload, type DeliveryStatus } from "../lib/operations/delivery-status";

const arabicLabels: Record<DeliveryStatus, string> = {
  preparing: "قيد التجهيز",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التسليم",
};
const englishLabels: Record<DeliveryStatus, string> = {
  preparing: "Preparing",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

test("delivery status options keep API keys independent from Arabic and English labels", () => {
  const arabicOptions = deliveryStatusOptions((status) => arabicLabels[status], "preparing");
  const englishOptions = deliveryStatusOptions((status) => englishLabels[status], "preparing");

  assert.deepEqual(arabicOptions.map((option) => option.value), ["preparing", "out_for_delivery"]);
  assert.deepEqual(englishOptions.map((option) => option.value), arabicOptions.map((option) => option.value));
  assert.deepEqual(arabicOptions.map((option) => option.label), ["قيد التجهيز", "خرج للتوصيل"]);
  assert.deepEqual(englishOptions.map((option) => option.label), ["Preparing", "Out for delivery"]);

  for (const option of arabicOptions) {
    const payload = deliveryStatusPayload(option.value);
    assert.deepEqual(payload, { deliveryStatus: option.value });
    assert.equal(deliveryStatusBodySchema.safeParse(payload).success, true);
  }
});

test("delivery payload accepts every contract key and rejects translated labels", () => {
  for (const status of DELIVERY_STATUS_VALUES) {
    assert.deepEqual(deliveryStatusPayload(status), { deliveryStatus: status });
    assert.equal(deliveryStatusBodySchema.safeParse(deliveryStatusPayload(status)).success, true);
  }

  assert.equal(deliveryStatusBodySchema.safeParse({ deliveryStatus: arabicLabels.delivered }).success, false);
  assert.equal(deliveryStatusBodySchema.safeParse({ deliveryStatus: englishLabels.delivered }).success, false);
});

test("delivery options expose only the next valid transition", () => {
  assert.deepEqual(deliveryStatusOptions((status) => status, "out_for_delivery").map((option) => option.value), ["out_for_delivery", "delivered"]);
});
