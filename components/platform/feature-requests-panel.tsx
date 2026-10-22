"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, Loading, Notice, useAction, useLoad } from "@/components/operations/shared";

type Row = { id: string; title: string; description: string; status: string; adminNote: string | null; tenantName: string; submittedByName: string; createdAt: string | Date };
const statuses = [{ value: "new", key: "requests.statusNew" }, { value: "under_review", key: "requests.statusUnderReview" }, { value: "planned", key: "requests.statusPlanned" }, { value: "completed", key: "requests.statusCompleted" }, { value: "declined", key: "requests.statusDeclined" }] as const;
export function FeatureRequestsPanel() {
  const t = useTranslations("platformAdmin");
  const { data, loading, reload } = useLoad<{ requests: Row[] }>("/api/super-admin/feature-requests");
  const action = useAction(); const [notes, setNotes] = useState<Record<string, string>>({});
  async function save(row: Row, status: string) { await action.execute(() => apiRequest(`/api/super-admin/feature-requests?id=${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ status, adminNote: notes[row.id] ?? row.adminNote ?? null }) }), t("requests.updateSuccess")); await reload(); }
  if (loading) return <Loading />;
  return <section className="space-y-4">{action.success && <Notice kind="success">{action.success}</Notice>}{action.error && <Notice>{action.error}</Notice>}{(data?.requests.length ?? 0) === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><ClipboardList className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-navy">{t("requests.empty")}</p></div> : data?.requests.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-teal">{row.tenantName} · {row.submittedByName}</p><h3 className="mt-1 text-lg font-bold text-navy">{row.title}</h3></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{statuses.find((item) => item.value === row.status)? t(statuses.find((item) => item.value === row.status)!.key) : t("requests.unknownStatus")}</span></div><p className="mt-3 text-sm leading-7 text-slate-600">{row.description}</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><textarea value={notes[row.id] ?? row.adminNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} rows={2} maxLength={1000} placeholder={t("requests.notePlaceholder")} className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal" /><div className="flex flex-wrap items-start gap-2">{statuses.map((status) => <Button key={status.value} type="button" variant={row.status === status.value ? "default" : "outline"} size="sm" onClick={() => void save(row, status.value)} disabled={action.busy}><Check size={14} />{t(status.key)}</Button>)}</div></div></article>)}</section>;
}
