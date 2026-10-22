import assert from "node:assert/strict";
import test from "node:test";
import { getLocalSlot, intervalsOverlap, isAppointmentCapableRole, isValidClock, isValidScheduleDate, schedulePersonRoleTranslationKey } from "../lib/operations/scheduling";

test("local schedule slots include the requested calendar date, weekday, and clock times", () => {
  const slot = getLocalSlot(new Date("2026-06-07T11:30:00.000Z"), new Date("2026-06-07T12:15:00.000Z"), "UTC");
  assert.deepEqual(slot, { date: "2026-06-07", weekday: 0, start: "11:30", end: "12:15" });
});

test("invalid or reversed appointment intervals are rejected", () => {
  assert.throws(() => getLocalSlot(new Date("invalid"), new Date("2026-06-07T12:15:00.000Z"), "UTC"));
  assert.throws(() => getLocalSlot(new Date("2026-06-07T12:15:00.000Z"), new Date("2026-06-07T11:30:00.000Z"), "UTC"));
});

test("clock validation rejects malformed hours and minutes", () => {
  assert.equal(isValidClock("09:30"), true);
  assert.equal(isValidClock("23:59"), true);
  assert.equal(isValidClock("24:00"), false);
  assert.equal(isValidClock("8:30"), false);
  assert.equal(isValidClock("12:60"), false);
});

test("touching schedule boundaries are allowed while true interval overlap is detected", () => {
  assert.equal(intervalsOverlap("10:00", "11:00", "11:00", "12:00"), false);
  assert.equal(intervalsOverlap("10:00", "11:00", "10:59", "12:00"), true);
  assert.equal(intervalsOverlap("10:00", "11:00", "09:00", "10:30"), true);
});

test("only clinical schedule roles are eligible for public appointments", () => {
  assert.equal(isAppointmentCapableRole("provider"), true);
  assert.equal(isAppointmentCapableRole("doctor"), true);
  assert.equal(isAppointmentCapableRole("specialist"), true);
  assert.equal(isAppointmentCapableRole("receptionist"), false);
  assert.equal(isAppointmentCapableRole("nurse"), false);
  assert.equal(isAppointmentCapableRole("storekeeper"), false);
});

test("schedule person role labels map to coordinated translation keys", () => {
  assert.equal(schedulePersonRoleTranslationKey("doctor"), "roles.doctor");
  assert.equal(schedulePersonRoleTranslationKey("specialist"), "roles.specialist");
  assert.equal(schedulePersonRoleTranslationKey("receptionist"), "roles.employee");
});

test("schedule dates reject impossible calendar days", () => {
  assert.equal(isValidScheduleDate("2026-02-28"), true);
  assert.equal(isValidScheduleDate("2026-02-29"), false);
  assert.equal(isValidScheduleDate("2026-13-01"), false);
  assert.equal(isValidScheduleDate("not-a-date"), false);
});
