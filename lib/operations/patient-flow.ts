export type PatientFlowStatus = "waiting" | "in_progress" | "completed";

export function patientFlowLabel(status: string): string | null {
  if (status === "waiting") return "قيد الانتظار في الاستقبال";
  if (status === "in_progress") return "داخل غرفة الكشف";
  if (status === "completed") return "مكتمل";
  return null;
}

export function nextPatientFlowStatus(status: string): "in_progress" | "completed" | null {
  if (status === "waiting") return "in_progress";
  if (status === "in_progress") return "completed";
  return null;
}
