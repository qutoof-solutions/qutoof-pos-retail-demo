import assert from "node:assert/strict";
import test from "node:test";
import { calculateAttendanceMetrics, canCloseAttendanceForScope, formatDuration } from "@/lib/operations/attendance";

test("calculates actual work minutes and scheduled lateness", () => {
  const shiftStart = new Date("2026-10-16T08:00:00.000Z");
  const clockIn = new Date("2026-10-16T08:17:00.000Z");
  const clockOut = new Date("2026-10-16T16:42:00.000Z");
  assert.deepEqual(calculateAttendanceMetrics(clockIn, clockOut, shiftStart), { totalMinutes: 505, lateMinutes: 17 });
});

test("does not produce negative durations", () => {
  assert.deepEqual(calculateAttendanceMetrics(new Date("2026-10-16T10:00:00Z"), new Date("2026-10-16T09:00:00Z")), { totalMinutes: 0, lateMinutes: 0 });
  assert.equal(formatDuration(125, "en"), "2h 5m");
  assert.equal(formatDuration(125, "ar"), "2 س 5 د");
});

type FakeAttendance = {
  id: string;
  tenantId: string;
  staffId: string;
  branchId: string;
  status: "open" | "closed";
  clockOut: Date | null;
};

function closeOneAttendance(rows: FakeAttendance[], scope: Parameters<typeof canCloseAttendanceForScope>[1], now: Date): FakeAttendance | null {
  const row = rows.find((candidate) => canCloseAttendanceForScope(candidate, scope));
  if (!row) return null;
  row.status = "closed";
  row.clockOut = now;
  return row;
}

test("does not close an open attendance record from another assigned branch", () => {
  const rows: FakeAttendance[] = [{ id: "attendance-1", tenantId: "tenant-1", staffId: "staff-1", branchId: "branch-a", status: "open", clockOut: null }];

  const closed = closeOneAttendance(rows, { tenantId: "tenant-1", staffId: "staff-1", branchId: "branch-b" }, new Date("2026-10-16T16:42:00.000Z"));

  assert.equal(closed, null);
  assert.equal(rows[0]?.status, "open");
  assert.equal(rows[0]?.clockOut, null);
});

test("closes the matching attendance record once and rejects a second close", () => {
  const rows: FakeAttendance[] = [{ id: "attendance-1", tenantId: "tenant-1", staffId: "staff-1", branchId: "branch-a", status: "open", clockOut: null }];
  const scope = { tenantId: "tenant-1", staffId: "staff-1", branchId: "branch-a" };
  const clockOut = new Date("2026-10-16T16:42:00.000Z");

  const first = closeOneAttendance(rows, scope, clockOut);
  const second = closeOneAttendance(rows, scope, new Date("2026-10-16T16:43:00.000Z"));

  assert.equal(first?.status, "closed");
  assert.equal(first?.clockOut, clockOut);
  assert.equal(second, null);
  assert.equal(rows[0]?.clockOut, clockOut);
});

test("does not close an attendance record outside the tenant or staff scope", () => {
  const rows: FakeAttendance[] = [{ id: "attendance-1", tenantId: "tenant-1", staffId: "staff-1", branchId: "branch-a", status: "open", clockOut: null }];
  const clockOut = new Date("2026-10-16T16:42:00.000Z");

  assert.equal(closeOneAttendance(rows, { tenantId: "tenant-2", staffId: "staff-1", branchId: "branch-a" }, clockOut), null);
  assert.equal(closeOneAttendance(rows, { tenantId: "tenant-1", staffId: "staff-2", branchId: "branch-a" }, clockOut), null);
  assert.equal(rows[0]?.status, "open");
  assert.equal(rows[0]?.clockOut, null);
});
