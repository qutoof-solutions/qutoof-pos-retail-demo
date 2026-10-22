export function calculateAttendanceMetrics(clockIn: Date, clockOut: Date, shiftStart?: Date | null): { totalMinutes: number; lateMinutes: number } {
  const totalMinutes = Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000));
  const lateMinutes = shiftStart ? Math.max(0, Math.round((clockIn.getTime() - shiftStart.getTime()) / 60_000)) : 0;
  return { totalMinutes, lateMinutes };
}

export type AttendanceClockOutScope = {
  tenantId: string;
  staffId: string;
  branchId: string;
};

export type AttendanceClockOutRecord = {
  tenantId: string;
  staffId: string;
  branchId: string;
  status: "open" | "closed";
  clockOut: Date | null;
};

/** The identity and open-state guard shared by the preflight and atomic update. */
export function canCloseAttendanceForScope(record: AttendanceClockOutRecord, scope: AttendanceClockOutScope): boolean {
  return record.tenantId === scope.tenantId
    && record.staffId === scope.staffId
    && record.branchId === scope.branchId
    && record.status === "open"
    && record.clockOut === null;
}

export function formatDuration(totalMinutes: number, locale: "ar" | "en" = "ar"): string {
  const hours = Math.floor(Math.max(0, totalMinutes) / 60);
  const minutes = Math.max(0, totalMinutes) % 60;
  return locale === "en" ? `${hours}h ${minutes}m` : `${hours} س ${minutes} د`;
}
