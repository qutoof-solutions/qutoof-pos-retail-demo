import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptWhatsAppToken, encryptWhatsAppToken, hmacSha256Hex, normalizeWhatsAppPhone, safeEqual } from "../lib/whatsapp/security";
import { localDateRangeToUtc, localTimeToUtc, safeLocalDateKey } from "../lib/time/timezone";
import { isLocalDateWithinBookingWindow } from "../lib/operations/public-availability";
import { isWithinDigitalTicketWindow } from "../lib/operations/digital-tickets";

const encryptionSecret = "qutoof-whatsapp-encryption-test-key-material-2026";

test("WhatsApp access tokens are AES-GCM encrypted and reject a changed key", async () => {
  const saved = await encryptWhatsAppToken("EAAG_test_access_token", encryptionSecret);
  assert.notEqual(saved.ciphertext, "EAAG_test_access_token");
  assert.equal(await decryptWhatsAppToken(saved.ciphertext, saved.nonce, encryptionSecret), "EAAG_test_access_token");
  await assert.rejects(() => decryptWhatsAppToken(saved.ciphertext, saved.nonce, `${encryptionSecret}-wrong`));
});

test("Meta webhook HMAC is deterministic and constant-length comparisons reject mismatches", async () => {
  const signature = await hmacSha256Hex("app-secret", "{\"object\":\"whatsapp_business_account\"}");
  assert.equal(signature.length, 64);
  assert.equal(safeEqual(signature, await hmacSha256Hex("app-secret", "{\"object\":\"whatsapp_business_account\"}")), true);
  assert.equal(safeEqual(signature, await hmacSha256Hex("other-secret", "{\"object\":\"whatsapp_business_account\"}")), false);
  assert.equal(safeEqual(signature, "short"), false);
});

test("WhatsApp phone normalization accepts Egyptian local/international forms and rejects invalid digits", () => {
  assert.equal(normalizeWhatsAppPhone("01012345678"), "201012345678");
  assert.equal(normalizeWhatsAppPhone("+20 (10) 1234-5678"), "201012345678");
  assert.equal(normalizeWhatsAppPhone("123"), null);
  assert.equal(normalizeWhatsAppPhone("002001012345678"), "201012345678");
});

test("public booking time conversion rejects invalid dates and converts wall time in the requested timezone", () => {
  assert.equal(localTimeToUtc("2026-02-30", "09:00", "UTC"), null);
  assert.equal(localTimeToUtc("2026-01-01", "24:00", "UTC"), null);
  assert.equal(localTimeToUtc("2026-01-01", "09:30", "UTC")?.toISOString(), "2026-01-01T09:30:00.000Z");
  assert.equal(localTimeToUtc("2026-01-01", "12:00", "Africa/Cairo")?.toISOString(), "2026-01-01T10:00:00.000Z");
});

test("financial report date ranges use tenant-local midnight with an exclusive next-midnight boundary", () => {
  const range = localDateRangeToUtc("2026-01-10", "2026-01-10", "America/New_York");
  assert.equal(range?.start.toISOString(), "2026-01-10T05:00:00.000Z");
  assert.equal(range?.end.toISOString(), "2026-01-11T05:00:00.000Z");
  assert.equal(range ? range.end.getTime() - range.start.getTime() : null, 86_400_000);
  assert.equal(safeLocalDateKey(new Date("2026-01-01T23:30:00.000Z"), "Asia/Tokyo"), "2026-01-02");
});

test("financial report date ranges preserve DST day lengths without changing local dates", () => {
  const spring = localDateRangeToUtc("2026-03-08", "2026-03-08", "America/New_York");
  const fall = localDateRangeToUtc("2026-11-01", "2026-11-01", "America/New_York");
  assert.equal(spring?.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(spring?.end.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(spring ? spring.end.getTime() - spring.start.getTime() : null, 23 * 3_600_000);
  assert.equal(fall?.start.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(fall?.end.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(fall ? fall.end.getTime() - fall.start.getTime() : null, 25 * 3_600_000);
});

test("financial report date range follows operational invalid-zone and invalid-date contract", () => {
  assert.equal(localDateRangeToUtc("2026-02-30", "2026-02-30", "UTC"), null);
  assert.equal(localDateRangeToUtc("2026-01-01", "2026-01-01", "Not/A_Timezone"), null);
  assert.equal(safeLocalDateKey(new Date("2026-01-01T00:00:00.000Z"), "Not/A_Timezone"), null);
});

test("booking window allows today and the next 90 days but rejects past and distant dates", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  assert.equal(isLocalDateWithinBookingWindow("2026-01-10", "UTC", now), true);
  assert.equal(isLocalDateWithinBookingWindow("2026-04-10", "UTC", now), true);
  assert.equal(isLocalDateWithinBookingWindow("2026-04-11", "UTC", now), false);
  assert.equal(isLocalDateWithinBookingWindow("2026-01-09", "UTC", now), false);
});

test("digital ticket gate accepts only the approved one-hour-before to thirty-minute-after window", () => {
  const startsAt = new Date("2026-01-10T12:00:00.000Z");
  const endsAt = new Date("2026-01-10T12:30:00.000Z");
  assert.equal(isWithinDigitalTicketWindow(startsAt, endsAt, new Date("2026-01-10T10:59:59.999Z")), false);
  assert.equal(isWithinDigitalTicketWindow(startsAt, endsAt, new Date("2026-01-10T11:00:00.000Z")), true);
  assert.equal(isWithinDigitalTicketWindow(startsAt, endsAt, new Date("2026-01-10T13:00:00.000Z")), true);
  assert.equal(isWithinDigitalTicketWindow(startsAt, endsAt, new Date("2026-01-10T13:00:00.001Z")), false);
});
