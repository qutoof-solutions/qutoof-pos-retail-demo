import assert from "node:assert/strict";
import test from "node:test";
import { applyTenantTerms, getTerm } from "../lib/terms";
import { parseAppointmentReply } from "../lib/whatsapp/actions";
import { getReminderSchedule } from "../lib/whatsapp/reminders";

test("tenant terminology includes clinical terms and vertical-specific equivalents", () => {
  assert.equal(getTerm("medical", "prescription"), "روشتة / وصفة طبية");
  assert.equal(getTerm("medical", "diagnosis"), "تشخيص");
  assert.equal(getTerm("medical", "medical_record"), "ملف طبي");
  assert.equal(getTerm("beauty", "provider"), "أخصائي");
  assert.equal(getTerm("consulting", "customer"), "موكل");
  assert.equal(applyTenantTerms("حجز كشف مع الطبيب للمريض", "sports"), "حجز حجز مع المدرب أو ملعب للمشترك");
});

test("booking notifications schedule both 24-hour and three-hour reminders only before their due times", () => {
  const start = new Date("2026-10-10T12:00:00.000Z");
  const now = new Date("2026-10-09T08:00:00.000Z");
  assert.deepEqual(getReminderSchedule(start, now).map((item) => [item.eventKind, item.scheduledAt.toISOString()]), [
    ["reminder", "2026-10-09T12:00:00.000Z"],
    ["reminder_3h", "2026-10-10T09:00:00.000Z"],
  ]);
  assert.deepEqual(getReminderSchedule(start, new Date("2026-10-10T11:00:00.000Z")).map((item) => [item.eventKind, item.scheduledAt.toISOString()]), [
    ["reminder_3h", "2026-10-10T11:00:00.000Z"],
  ]);
});

test("WhatsApp replies resolve explicit confirm, reschedule and cancellation actions", () => {
  assert.deepEqual(parseAppointmentReply("confirm:abc123_XYZ"), { action: "confirm", code: "ABC123_XYZ" });
  assert.deepEqual(parseAppointmentReply("reschedule ABC123_XYZ"), { action: "reschedule", code: "ABC123_XYZ" });
  assert.deepEqual(parseAppointmentReply("cancel:ABC123_XYZ"), { action: "cancel", code: "ABC123_XYZ" });
  assert.equal(parseAppointmentReply("cancel:bad"), null);
  assert.equal(parseAppointmentReply("hello"), null);
});
