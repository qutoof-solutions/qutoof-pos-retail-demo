import assert from "node:assert/strict";
import test from "node:test";
import { canRetryWhatsAppNotification, localDateAndTime } from "../services/whatsapp";
import { hmacSha256Hex, safeEqual } from "../lib/whatsapp/security";

test("WhatsApp webhook HMAC is deterministic and compared safely", async () => {
  const signature = await hmacSha256Hex("test-secret", '{"entry":[]}');
  assert.equal(signature, "5c12cee8c89f16c81647beec6d874ab35c12af18787cc4bbbd623e650ce7ecf5");
  assert.equal(safeEqual(signature, signature), true);
  assert.equal(safeEqual(signature, `${signature}0`), false);
  assert.equal(safeEqual(signature, signature.slice(0, -1)), false);
});

test("WhatsApp retry queue accepts only failed/cancelled rows and never a sent row", () => {
  assert.equal(canRetryWhatsAppNotification("failed", 8), true);
  assert.equal(canRetryWhatsAppNotification("cancelled", 0), true);
  assert.equal(canRetryWhatsAppNotification("queued", 0), false);
  assert.equal(canRetryWhatsAppNotification("sent", 1), false);
  assert.equal(canRetryWhatsAppNotification("failed", -1), false);
});

test("WhatsApp notification history formats the same instant in Arabic and English locale", () => {
  const value = new Date("2026-01-05T15:30:00.000Z");
  const ar = localDateAndTime(value, "Africa/Cairo", "ar");
  const en = localDateAndTime(value, "Africa/Cairo", "en");
  assert.match(ar.date, /يناير|2026/);
  assert.match(en.date, /January|2026/);
  assert.notEqual(ar.date, en.date);
  assert.equal(ar.time.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))), en.time);
});
