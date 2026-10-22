"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Building2, LoaderCircle, RefreshCw, Search, ShieldAlert, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate } from "@/components/platform/api-client";

type Tenant = { id: string; name: string; slug: string; vertical: string; status: string; createdAt: string; trialStartedAt: string | null; trialEndsAt: string | null; subscriptionEndsAt: string | null; platformPlanId: string | null; ownerName: string | null; ownerEmail: string | null; planName: string | null };
type Plan = { id: string; nameAr: string; isActive: boolean; catalogKind: "plan" | "addon" | "invalid_addon" };
type TenantsResponse = { tenants: Tenant[]; page: number; hasMore: boolean };
const statuses = [{ value: "", key: "tenants.allStatuses" }, { value: "pending_trial", key: "tenants.statusPendingTrial" }, { value: "active_trial", key: "tenants.statusTrial" }, { value: "active", key: "tenants.statusActive" }, { value: "grace", key: "tenants.statusGrace" }, { value: "expired", key: "tenants.statusExpired" }, { value: "frozen", key: "tenants.statusFrozen" }, { value: "cancelled", key: "tenants.statusCancelled" }] as const;
const tenantStatusKeys: Record<string, string> = { pending_trial: "tenants.statusPendingTrial", active_trial: "tenants.statusTrial", active: "tenants.statusActive", grace: "tenants.statusGrace", expired: "tenants.statusExpired", frozen: "tenants.statusFrozen", cancelled: "tenants.statusCancelled" };

export function TenantDirectory() {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const router = useRouter();
  const [rows, setRows] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (appliedQuery) params.set("q", appliedQuery);
      if (status) params.set("status", status);
      const [tenantResult, planResult] = await Promise.all([
        apiRequest<TenantsResponse>(`/api/super-admin/tenants?${params}`),
        apiRequest<{ plans: Plan[] }>("/api/super-admin/plans"),
      ]);
      const basePlans = planResult.plans.filter((plan) => plan.isActive && plan.catalogKind === "plan");
      const basePlanIds = new Set(basePlans.map((plan) => plan.id));
      setRows(tenantResult.tenants); setHasMore(tenantResult.hasMore); setPlans(basePlans);
      setSelectedPlans((current) => Object.fromEntries(tenantResult.tenants.map((tenant) => {
        const currentSelection = current[tenant.id];
        const selectedPlan = currentSelection && basePlanIds.has(currentSelection) ? currentSelection : basePlanIds.has(tenant.platformPlanId ?? "") ? tenant.platformPlanId! : "";
        return [tenant.id, selectedPlan];
      })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("tenants.loadError")); }
  }, [appliedQuery, page, status, t]);
  useEffect(() => { void load(); }, [load]);

  async function tenantAction(tenant: Tenant, body: Record<string, unknown>) {
    if (body.action === "freeze" && !window.confirm(t("tenants.confirmFreeze"))) return;
    setBusyId(tenant.id); setError(""); setNotice("");
    try {
      await apiRequest(`/api/super-admin/tenants/${tenant.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setNotice(t("tenants.actionSuccess")); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("tenants.actionError")); }
    finally { setBusyId(""); }
  }

  async function extendTrial(tenant: Tenant) {
    const raw = window.prompt(t("tenants.extendTrialPrompt"), "7");
    if (raw === null) return;
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 180) { setError(t("tenants.invalidTrialDays")); return; }
    await tenantAction(tenant, { action: "extend_trial", days });
  }

  async function changePlan(tenant: Tenant) {
    const planId = selectedPlans[tenant.id];
    if (!planId) { setError(t("tenants.noActivePlan")); return; }
    await tenantAction(tenant, { action: "change_plan", planId });
  }

  async function impersonate(tenant: Tenant) {
    setBusyId(tenant.id); setError("");
    try {
      const result = await apiRequest<{ redirectTo: string }>("/api/super-admin/impersonation/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id }) });
      router.replace(result.redirectTo); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("tenants.impersonationError")); setBusyId(""); }
  }

  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setAppliedQuery(query.trim()); }
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("tenants.management")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("tenants.directory")}</h1><p className="mt-2 text-sm text-slate-600">{t("tenants.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={16} />{t("common.refresh")}</Button></div>
    <form onSubmit={search} className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4"><label className="sr-only" htmlFor="tenant-search">{t("tenants.searchLabel")}</label><div className="flex min-w-60 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3"><Search size={17} className="text-slate-400" /><input id="tenant-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tenants.searchPlaceholder")} className="h-10 min-w-0 flex-1 outline-none" /></div><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">{statuses.map((item) => <option key={item.value} value={item.value}>{t(item.key)}</option>)}</select><Button type="submit"><Search size={16} />{t("common.search")}</Button></form>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-[1050px] w-full text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-4">{t("tenants.tenantOwner")}</th><th className="p-4">{t("common.status")}</th><th className="p-4">{t("tenants.planPeriod")}</th><th className="p-4">{t("tenants.createdAt")}</th><th className="p-4">{t("common.actions")}</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((tenant) => <tr key={tenant.id} className="align-top"><td className="p-4"><strong className="block text-navy">{tenant.name}</strong><span className="mt-1 block text-xs text-slate-500">/{tenant.slug} · {tenant.vertical}</span><span className="mt-1 block text-xs text-slate-600">{tenant.ownerName ?? t("tenants.noOwner")} · {tenant.ownerEmail ?? "—"}</span></td><td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tenant.status === "active" ? "bg-teal/10 text-teal" : tenant.status === "frozen" || tenant.status === "expired" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{(tenantStatusKeys[tenant.status] ? t(tenantStatusKeys[tenant.status]) : t("tenants.unknownStatus"))}</span><span className="mt-2 block text-xs text-slate-500">{tenant.trialEndsAt ? `${t("tenants.trialPrefix")} ${formatDate(tenant.trialEndsAt, locale)}` : tenant.subscriptionEndsAt ? `${t("tenants.subscriptionPrefix")} ${formatDate(tenant.subscriptionEndsAt, locale)}` : t("tenants.noPeriodEnd")}</span></td><td className="p-4"><span className="block text-slate-700">{tenant.planName ?? t("tenants.noPlan")}</span><div className="mt-2 flex gap-1"><select value={selectedPlans[tenant.id] ?? ""} onChange={(event) => setSelectedPlans((current) => ({ ...current, [tenant.id]: event.target.value }))} className="h-9 max-w-40 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="">{t("tenants.changePlan")}</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.nameAr}</option>)}</select><Button variant="outline" size="sm" disabled={busyId === tenant.id || !selectedPlans[tenant.id]} onClick={() => void changePlan(tenant)}>{t("common.apply")}</Button></div></td><td className="p-4 text-xs text-slate-600">{formatDate(tenant.createdAt, locale)}</td><td className="p-4"><div className="flex flex-wrap gap-2">{tenant.status === "frozen" ? <Button variant="outline" size="sm" disabled={busyId === tenant.id} onClick={() => void tenantAction(tenant, { action: "unfreeze" })}>{t("tenants.unfreeze")}</Button> : <Button variant="outline" size="sm" disabled={busyId === tenant.id} onClick={() => void tenantAction(tenant, { action: "freeze" })}><ShieldAlert size={14} />{t("tenants.freeze")}</Button>}<Button variant="outline" size="sm" disabled={busyId === tenant.id} onClick={() => void extendTrial(tenant)}>{t("tenants.extendTrial")}</Button><Button variant="outline" size="sm" disabled={busyId === tenant.id} onClick={() => void impersonate(tenant)}><UserRoundCog size={14} />{t("tenants.impersonate")}</Button></div></td></tr>)}{!rows.length && <tr><td colSpan={5} className="p-10 text-center text-slate-500"><Building2 className="mx-auto mb-2" size={22} />{t("tenants.noMatches")}</td></tr>}</tbody></table></div>
    <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{t("tenants.page")} {new Intl.NumberFormat(locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn").format(page)} · {t("tenants.pageLimit")}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("common.previous")}</Button><Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</Button></div></div>
    {busyId && <div className="fixed bottom-20 left-4 z-30 flex items-center gap-2 rounded-xl bg-navy px-4 py-3 text-sm text-white shadow-lg"><LoaderCircle size={16} className="animate-spin" />{t("tenants.saving")}</div>}
  </section>;
}
