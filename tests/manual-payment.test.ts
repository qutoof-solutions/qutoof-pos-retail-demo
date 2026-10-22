import assert from "node:assert/strict";
import { test } from "node:test";
import { hasManualPaymentSettings, publicManualPayment } from "../lib/operations/manual-payment";

test("manual payment instructions are not exposed as a payment channel by themselves", () => {
  assert.equal(publicManualPayment({ paymentInstructions: "حوّل إلى الحساب المعتاد" }), null);
  assert.equal(hasManualPaymentSettings({ paymentInstructions: "حوّل إلى الحساب المعتاد" }), false);
});

test("manual wallet and InstaPay settings are trimmed and returned as public booking details", () => {
  const details = publicManualPayment({
    mobileWalletLabel: " Vodafone Cash ",
    mobileWalletNumber: " +201000000000 ",
    instapayLink: " https://instapay.example/pay ",
    instapayQrUrl: "",
    paymentInstructions: " اكتب رمز الحجز في المرجع ",
  });
  assert.deepEqual(details, {
    mobileWalletLabel: "Vodafone Cash",
    mobileWalletNumber: "+201000000000",
    instapayLink: "https://instapay.example/pay",
    instapayQrUrl: "",
    paymentInstructions: "اكتب رمز الحجز في المرجع",
  });
  assert.equal(hasManualPaymentSettings(details), true);
});

test("QR-only manual payment settings are supported", () => {
  assert.equal(hasManualPaymentSettings({ instapayQrUrl: "https://example.test/qr.png" }), true);
});
