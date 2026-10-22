"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate } from "@/components/platform/api-client";

type AuditLog = { id: string; actorId: string | null; actorName: string | null; actorEmail: string | null; action: string; resourceType: string; resourceId: string | null; ipAddress: string | null; userAgent: string | null; metadata: Record<string, unknown>; createdAt: string };
const labelKeys: Record<string, string> = { "tenant.frozen": "auditLog.actions.tenantFrozen", "tenant.unfrozen": "auditLog.actions.tenantUnfrozen", "tenant.trial_extended": "auditLog.actions.tenantTrialExtended", "tenant.plan_changed": "auditLog.actions.tenantPlanChanged", "tenant.impersonation_started": "auditLog.actions.tenantImpersonationStarted", "tenant.impersonation_stopped": "auditLog.actions.tenantImpersonationStopped", "billing.request_approved": "auditLog.actions.billingRequestApproved", "billing.request_rejected": "auditLog.actions.billingRequestRejected", "platform_plan.created": "auditLog.actions.platformPlanCreated", "platform_plan.updated": "auditLog.actions.platformPlanUpdated", "platform_plan.deactivated": "auditLog.actions.platformPlanDeactivated", "platform.settings_updated": "auditLog.actions.platformSettingsUpdated", "platform.feature_flag_changed": "auditLog.actions.platformFeatureFlagChanged", "billing.telegram_notification_retried": "auditLog.actions.telegramNotificationRetried" };

export function AuditLogPanel() {
  const locale = useLocale();
  const t = useTranslations("remaining-platform-print");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await apiRequest<{ logs: AuditLog[]; hasMore: boolean }>(`/api/super-admin/audit-logs?page=${page}`); setLogs(result.logs); setHasMore(result.hasMore); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("auditLog.loadError")); }
    finally { setLoading(false); }
  }, [page, t]);
  useEffect(() => { void load(); }, [load]);

  return <section className="space-y-5" dir={locale === "ar" ? "rtl" : "ltr"}><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("auditLog.eyebrow")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("auditLog.title")}</h1><p className="mt-2 text-sm text-slate-600">{t("auditLog.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{t("common.refresh")}</Button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="space-y-3">{logs.map((log) => <article key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl bg-navy text-teal-bright"><Activity size={17} /></span><div><h2 className="font-semibold text-navy">{labelKeys[log.action] ? t(labelKeys[log.action]) : log.action}</h2><p className="mt-1 text-xs text-slate-500">{log.actorName ?? t("auditLog.unknownUser")}{log.actorEmail ? ` · ${log.actorEmail}` : ""} · {log.resourceType}{log.resourceId ? ` · ${log.resourceId}` : ""}</p></div></div><time className="text-xs text-slate-500">{formatDate(log.createdAt, locale)}</time></div><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-teal">{t("auditLog.eventDetails")}</summary><div className="mt-2 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2"><p>IP: <span dir="ltr">{log.ipAddress ?? "—"}</span></p><p>{t("auditLog.actor")} <code dir="ltr">{log.actorId ?? "—"}</code></p><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2 sm:col-span-2">{JSON.stringify(log.metadata, null, 2)}</pre></div></details></article>)}{!logs.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-9 text-center text-sm text-slate-500">{loading ? <><LoaderCircle className="mx-auto mb-2 animate-spin" size={18} />{t("auditLog.loading")}</> : error ? t("auditLog.loadError") : t("auditLog.noRows")}</div>}</div>
    <div className="flex justify-between"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</Button><span className="self-center text-xs text-slate-500">{t("auditLog.page")} {page}</span><Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</Button></div>
  </section>;
}
