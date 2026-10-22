"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, LoaderCircle, Plus, RefreshCw, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatMoney } from "@/components/platform/api-client";
import {
  addResourceAddonMarker,
  RESOURCE_ADDON_TYPES,
  stripResourceAddonMarkers,
  type ResourceAddonType,
} from "@/lib/platform/catalog";
import { filterPlansForArchiveView, type PlanArchiveView } from "@/lib/platform/plan-archive";

type Cycle = "monthly" | "quarterly" | "semi_annual" | "annual" | "custom_days";
type CatalogKind = "plan" | "addon" | "invalid_addon";
type Plan = {
  id: string;
  code: string | null;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  billingCycle: Cycle;
  customDays: number | null;
  priceMinor: number;
  currency: string;
  features: Record<string, boolean>;
  maxUsers: number | null;
  maxBranches: number | null;
  maxWarehouses: number | null;
  isActive: boolean;
  catalogKind: CatalogKind;
  addonResourceType: ResourceAddonType | null;
};
type PlansResponse = { plans: Plan[] };
const cycleLabelKeys: Record<Cycle, string> = { monthly: "plans.cycleMonthly", quarterly: "plans.cycleQuarterly", semi_annual: "plans.cycleSemiAnnual", annual: "plans.cycleAnnual", custom_days: "plans.cycleCustomDays" };
const resourceLabelKeys: Record<ResourceAddonType, string> = { warehouse: "plans.resourceWarehouse", branch: "plans.resourceBranch", user: "plans.resourceUser", doctor: "plans.resourceDoctor" };

export function PlansPanel() {
  const t = useTranslations("platformAdmin");
  const locale = useLocale();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [archiveView, setArchiveView] = useState<PlanArchiveView>("active");
  const [createCatalogKind, setCreateCatalogKind] = useState<"plan" | "addon">("plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeCount = plans.filter((plan) => plan.isActive).length;
  const archivedCount = plans.length - activeCount;
  const visiblePlans = filterPlansForArchiveView(plans, archiveView);
  const load = useCallback(async () => {
    setError("");
    try { setPlans((await apiRequest<PlansResponse>("/api/super-admin/plans")).plans); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("plans.loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const cycle = String(form.get("billingCycle")) as Cycle;
    const price = Number(form.get("priceEgp"));
    const catalogKind = String(form.get("catalogKind"));
    const resourceType = String(form.get("addonResourceType"));
    if (catalogKind !== "plan" && catalogKind !== "addon") { setError(t("plans.chooseCatalogKind")); return; }
    if (catalogKind === "addon" && !isResourceAddonType(resourceType)) { setError(t("plans.chooseResourceType")); return; }
    if (!Number.isFinite(price) || price <= 0) { setError(t("plans.enterPositivePrice")); return; }
    const featureInput = String(form.get("features") ?? "");
    if (!validFeatureInput(featureInput)) { setError(t("plans.featureKeyFormat")); return; }
    const features = addResourceAddonMarker(featureMap(featureInput), catalogKind === "addon" ? resourceType as ResourceAddonType : null);
    const limits = catalogKind === "plan" ? readPlanLimits(form) : undefined;
    if (catalogKind === "plan" && !limits) { setError(t("plans.limitsRequired")); return; }
    const body = { nameAr: String(form.get("nameAr") ?? "").trim(), nameEn: String(form.get("nameEn") ?? "").trim(), descriptionAr: String(form.get("descriptionAr") ?? "").trim(), descriptionEn: String(form.get("descriptionEn") ?? "").trim(), billingCycle: cycle, ...(cycle === "custom_days" ? { customDays: Number(form.get("customDays")) } : {}), priceMinor: Math.round(price * 100), currency: "EGP", features, ...(limits ?? {}) };
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/api/super-admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      formElement.reset();
      setCreateCatalogKind("plan");
      setArchiveView("active");
      setNotice(catalogKind === "addon" ? t("plans.addonCreated") : t("plans.planCreated"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("plans.createError")); }
    finally { setBusy(false); }
  }

  async function toggle(plan: Plan) {
    if (plan.isActive && !window.confirm(t("plans.archiveConfirm"))) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/super-admin/plans/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !plan.isActive }) }); setNotice(plan.isActive ? t("plans.archiveSuccess") : t("plans.restoreSuccess")); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("plans.toggleError")); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("plans.catalog")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("plans.title")}</h1><p className="mt-2 text-sm text-slate-600">{t("plans.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15} />{t("common.refresh")}</Button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    <form onSubmit={createPlan} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-6">
      <div className="sm:col-span-2"><label className="text-xs font-semibold text-slate-600">{t("plans.nameArabic")}<input name="nameAr" required minLength={2} maxLength={80} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder={t("plans.nameArPlaceholder")} /></label></div>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.nameEnglish")}<input name="nameEn" required minLength={2} maxLength={120} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder={t("plans.nameEnPlaceholder")} dir="ltr" /></label></div>
      <label className="sm:col-span-2 xl:col-span-3 text-xs font-semibold text-slate-600">{t("plans.descriptionArabic")}<textarea name="descriptionAr" maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder={t("plans.descriptionArPlaceholder")} /></label>
      <label className="sm:col-span-2 xl:col-span-3 text-xs font-semibold text-slate-600">{t("plans.descriptionEnglish")}<textarea name="descriptionEn" maxLength={2000} rows={3} dir="ltr" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder={t("plans.descriptionEnPlaceholder")} /></label>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.catalogKind")}<select name="catalogKind" value={createCatalogKind} onChange={(event) => setCreateCatalogKind(event.currentTarget.value as "plan" | "addon")} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="plan">{t("plans.tenantPlan")}</option><option value="addon">{t("plans.resourceAddon")}</option></select></label></div>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.additionalResource")}<select name="addonResourceType" defaultValue="warehouse" className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{RESOURCE_ADDON_TYPES.map((type) => <option key={type} value={type}>{t(resourceLabelKeys[type])}</option>)}</select></label></div>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.billingCycle")}<select name="billingCycle" className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{Object.entries(cycleLabelKeys).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label></div>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.priceEgp")}<input name="priceEgp" required type="number" min="0.01" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="0.00" dir="ltr" /></label></div>
      <div><label className="text-xs font-semibold text-slate-600">{t("plans.customDays")}<input name="customDays" type="number" min="1" max="3650" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" dir="ltr" /></label></div>
      <div className="sm:col-span-2 xl:col-span-4"><label className="text-xs font-semibold text-slate-600">{t("plans.featuresSeparated")}<input name="features" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder={t("plans.featureKeyPlaceholder")} dir="ltr" /><span className="mt-1 block font-normal text-slate-500">{t("plans.resourceMarkerNote")}</span></label></div>
      {createCatalogKind === "plan" && <UsageLimitFields values={{}} />}
      <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}{t("plans.addToCatalog")}</Button></div>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-slate-600">{t("plans.catalogView")}</p>
      <div role="group" aria-label={t("plans.catalogView")} className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
        <button type="button" aria-pressed={archiveView === "active"} onClick={() => setArchiveView("active")} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${archiveView === "active" ? "bg-teal text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>{t("plans.activeItems")} <span className="ms-1 opacity-75">{activeCount}</span></button>
        <button type="button" aria-pressed={archiveView === "archived"} onClick={() => setArchiveView("archived")} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${archiveView === "archived" ? "bg-teal text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>{t("plans.archivedItems")} <span className="ms-1 opacity-75">{archivedCount}</span></button>
      </div>
    </div>
    <div className="space-y-3">{visiblePlans.map((plan) => <PlanEditor key={plan.id} plan={plan} disabled={busy} onSave={async (body) => { setBusy(true); setError(""); try { await apiRequest(`/api/super-admin/plans/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setNotice(t("plans.saveSuccess")); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("plans.saveError")); } finally { setBusy(false); } }} onToggle={() => void toggle(plan)} />)}{!visiblePlans.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900"><XCircle className="mx-auto mb-2" size={20} />{t(archiveView === "active" ? "plans.activeEmpty" : "plans.archivedEmpty")}</div>}</div>
  </section>;
}

function PlanEditor({ plan, disabled, onSave, onToggle }: { plan: Plan; disabled: boolean; onSave: (body: Record<string, unknown>) => Promise<void>; onToggle: () => void }) {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initialKind: CatalogKind = plan.catalogKind === "invalid_addon" ? "invalid_addon" : plan.catalogKind;
  const [catalogKindView, setCatalogKindView] = useState<CatalogKind>(initialKind);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const billingCycle = String(form.get("billingCycle")) as Cycle;
    const price = Number(form.get("priceEgp"));
    const catalogKind = String(form.get("catalogKind"));
    const resourceType = String(form.get("addonResourceType"));
    if (catalogKind !== "plan" && catalogKind !== "addon") { setError(t("plans.invalidAddonType")); return; }
    if (catalogKind === "addon" && !isResourceAddonType(resourceType)) { setError(t("plans.chooseResourceType")); return; }
    if (!Number.isFinite(price) || price <= 0) { setError(t("plans.pricePositive")); return; }
    const featureInput = String(form.get("features") ?? "");
    if (!validFeatureInput(featureInput)) { setError(t("plans.featureKeyFormat")); return; }
    const features = addResourceAddonMarker(featureMap(featureInput), catalogKind === "addon" ? resourceType as ResourceAddonType : null);
    const limits = catalogKind === "plan" ? readPlanLimits(form) : undefined;
    if (catalogKind === "plan" && !limits) { setError(t("plans.limitsRequired")); return; }
    const body = { nameAr: String(form.get("nameAr") ?? "").trim(), nameEn: String(form.get("nameEn") ?? "").trim(), descriptionAr: String(form.get("descriptionAr") ?? "").trim(), descriptionEn: String(form.get("descriptionEn") ?? "").trim(), code: String(form.get("code") ?? "").trim() || undefined, billingCycle, customDays: billingCycle === "custom_days" ? Number(form.get("customDays")) : null, priceMinor: Math.round(price * 100), features, ...(limits ?? {}) };
    setSaving(true); setError("");
    try { await onSave(body); } catch (cause) { setError(cause instanceof Error ? cause.message : t("plans.saveError")); }
    finally { setSaving(false); }
  }
  const catalogSummary = plan.catalogKind === "addon" && plan.addonResourceType ? `${t("plans.resourceAddonSummary")}${t(resourceLabelKeys[plan.addonResourceType])}` : plan.catalogKind === "invalid_addon" ? t("plans.invalidAddonCorrection") : t("plans.tenantPlan");
  const cleanFeatures = stripResourceAddonMarkers(plan.features);
  return <details className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4"><span className="flex items-center gap-2 font-bold text-navy">{plan.isActive ? <BadgeCheck size={18} className="text-teal" /> : <XCircle size={18} className="text-slate-400" />}{plan.nameAr}<span className="text-xs font-normal text-slate-500">{catalogSummary} · {formatMoney(plan.priceMinor, plan.currency, locale)} · {t(cycleLabelKeys[plan.billingCycle])}{plan.billingCycle === "custom_days" ? ` (${plan.customDays} ${t("plans.days")})` : ""}</span></span><span className={`rounded-full px-2.5 py-1 text-xs ${plan.isActive ? "bg-teal/10 text-teal" : "bg-slate-100 text-slate-500"}`}>{plan.isActive ? t("plans.available") : t("plans.inactive")}</span></summary>
    <form onSubmit={submit} className="grid gap-3 border-t border-slate-100 p-4 dark:border-slate-700 sm:grid-cols-2 xl:grid-cols-6">
      <label className="text-xs font-semibold text-slate-600">{t("plans.nameArabic")}<input name="nameAr" required defaultValue={plan.nameAr} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.nameEnglish")}<input name="nameEn" required defaultValue={plan.nameEn} minLength={2} maxLength={120} dir="ltr" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /><input type="hidden" name="code" value={plan.code ?? ""} readOnly /></label>
      <label className="sm:col-span-2 xl:col-span-3 text-xs font-semibold text-slate-600">{t("plans.descriptionArabic")}<textarea name="descriptionAr" defaultValue={plan.descriptionAr ?? ""} maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder={t("plans.descriptionArPlaceholder")} /></label>
      <label className="sm:col-span-2 xl:col-span-3 text-xs font-semibold text-slate-600">{t("plans.descriptionEnglish")}<textarea name="descriptionEn" defaultValue={plan.descriptionEn ?? ""} maxLength={2000} rows={4} dir="ltr" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder={t("plans.descriptionEnPlaceholder")} /></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.catalogKind")}<select name="catalogKind" value={catalogKindView} onChange={(event) => setCatalogKindView(event.currentTarget.value as CatalogKind)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="plan">{t("plans.tenantPlan")}</option><option value="addon">{t("plans.resourceAddon")}</option>{plan.catalogKind === "invalid_addon" && <option value="invalid_addon">{t("plans.invalidCatalogKind")}</option>}</select></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.additionalResource")}<select name="addonResourceType" defaultValue={plan.addonResourceType ?? "warehouse"} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{RESOURCE_ADDON_TYPES.map((type) => <option key={type} value={type}>{t(resourceLabelKeys[type])}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.billingCycle")}<select name="billingCycle" defaultValue={plan.billingCycle} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{Object.entries(cycleLabelKeys).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.priceEgp")}<input name="priceEgp" required type="number" min="0.01" step="0.01" defaultValue={(plan.priceMinor / 100).toFixed(2)} dir="ltr" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <label className="text-xs font-semibold text-slate-600">{t("plans.customDays")}<input name="customDays" type="number" min="1" max="3650" defaultValue={plan.customDays ?? ""} dir="ltr" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
      {catalogKindView === "plan" && <UsageLimitFields values={{ maxUsers: plan.maxUsers, maxBranches: plan.maxBranches, maxWarehouses: plan.maxWarehouses }} />}
      <label className="text-xs font-semibold text-slate-600 sm:col-span-2 xl:col-span-4">{t("plans.featureKeys")}<input name="features" defaultValue={Object.keys(cleanFeatures).filter((key) => cleanFeatures[key]).join(",")} dir="ltr" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-2"><Button type="submit" disabled={disabled || saving}>{saving ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}{t("common.save")}</Button><Button type="button" variant="outline" disabled={disabled} onClick={onToggle}>{plan.isActive ? t("plans.archive") : t("plans.restore")}</Button></div>
      {error && <p role="alert" className="text-xs text-red-700 sm:col-span-2 xl:col-span-6">{error}</p>}
    </form>
  </details>;
}

type PlanLimitFields = { maxUsers: number | null; maxBranches: number | null; maxWarehouses: number | null };
type PlanLimitName = keyof PlanLimitFields;
const usageLimitKeys: Record<PlanLimitName, string> = { maxUsers: "plans.maxUsers", maxBranches: "plans.maxBranches", maxWarehouses: "plans.maxWarehouses" };

function readPlanLimits(form: FormData): PlanLimitFields | null {
  const values = {} as PlanLimitFields;
  for (const name of Object.keys(usageLimitKeys) as PlanLimitName[]) {
    if (form.get(`${name}Unlimited`) === "on") { values[name] = null; continue; }
    const raw = form.get(name);
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
    values[name] = value;
  }
  return values;
}

function UsageLimitFields({ values }: { values: Partial<PlanLimitFields> }) {
  const t = useTranslations("platformAdmin");
  return <fieldset className="sm:col-span-2 xl:col-span-6 rounded-xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20"><legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">{t("plans.usageLimits")}</legend><p className="mb-3 text-[11px] font-normal text-slate-500 dark:text-slate-400">{t("plans.usageLimitsHelp")}</p><div className="grid gap-3 sm:grid-cols-3">{(Object.keys(usageLimitKeys) as PlanLimitName[]).map((name) => <UsageLimitInput key={name} name={name} label={t(usageLimitKeys[name])} unlimitedLabel={t("plans.unlimited")} value={values[name]} />)}</div></fieldset>;
}

function UsageLimitInput({ name, label, unlimitedLabel, value }: { name: PlanLimitName; label: string; unlimitedLabel: string; value: number | null | undefined }) {
  const [unlimited, setUnlimited] = useState(value === null);
  return <div className="min-w-0"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<input name={name} type="number" min="0" max="1000000" step="1" required={!unlimited} disabled={unlimited} defaultValue={value ?? ""} dir="ltr" className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900" /></label><label className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300"><input type="checkbox" name={`${name}Unlimited`} defaultChecked={value === null} onChange={(event) => setUnlimited(event.currentTarget.checked)} />{unlimitedLabel}</label></div>;
}

function featureMap(input: string): Record<string, boolean> {
  return Object.fromEntries(input.split(",").map((value) => value.trim().toLowerCase()).filter((value) => /^[a-z0-9_]{1,48}$/.test(value)).map((value) => [value, true]));
}

function validFeatureInput(input: string): boolean {
  return input.split(",").map((value) => value.trim()).filter(Boolean).length <= 64 && input.split(",").map((value) => value.trim()).filter(Boolean).every((value) => /^[a-z0-9_]{1,48}$/i.test(value));
}

function isResourceAddonType(value: string): value is ResourceAddonType {
  return (RESOURCE_ADDON_TYPES as readonly string[]).includes(value);
}
