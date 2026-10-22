import { useTranslations } from "next-intl";

export const APPOINTMENT_STATUSES = {
  pending: { label: "بانتظار التأكيد", labelKey: "pending", className: "bg-amber-100 text-amber-800 border-amber-200" },
  confirmed: { label: "مؤكد", labelKey: "confirmed", className: "bg-sky-100 text-sky-800 border-sky-200" },
  waiting: { label: "في الانتظار", labelKey: "waiting", className: "bg-violet-100 text-violet-800 border-violet-200" },
  in_progress: { label: "داخل الخدمة", labelKey: "inProgress", className: "bg-teal/10 text-teal border-teal/20" },
  completed: { label: "مكتمل", labelKey: "completed", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  no_show: { label: "لم يحضر", labelKey: "noShow", className: "bg-orange-100 text-orange-800 border-orange-200" },
  cancelled: { label: "ملغي", labelKey: "cancelled", className: "bg-slate-100 text-slate-600 border-slate-200" },
} as const;

export function StatusBadge({ status, patientFlow = false }: { status: keyof typeof APPOINTMENT_STATUSES; patientFlow?: boolean }) {
  const item = APPOINTMENT_STATUSES[status];
  const t = useTranslations("statuses");
  const patientKey = status === "waiting" ? "patientWaiting" : status === "in_progress" ? "patientRoom" : status === "completed" ? "completed" : null;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${item.className}`}>{patientFlow && patientKey ? t(patientKey) : t(item.labelKey)}</span>;
}
