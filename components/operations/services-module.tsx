"use client";

import { useEffect, useState } from "react";
import { Layers3, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest, formatMoney, InputField, Loading, Modal, ModuleTitle, Notice, SelectField, useAction, useLoad } from "@/components/operations/shared";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Service = { id: string; name: string; description: string | null; kind: "single" | "package" | "subscription"; priceMinor: number; durationMinutes: number; providerCommissionBps: number; providerCommissionMode: "percentage" | "fixed"; providerCommissionFixedMinor: number; sessionCount: number; validityDays: number | null; branchId: string | null; isActive: boolean };
type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type ServiceForm = { name: string; description: string; kind: Service["kind"]; price: string; durationMinutes: string; providerCommissionMode: "percentage" | "fixed"; providerCommissionPercent: string; providerCommissionFixed: string; sessionCount: string; validityDays: string; branchId: string };
const blank: ServiceForm = { name: "", description: "", kind: "single", price: "", durationMinutes: "30", providerCommissionMode: "percentage", providerCommissionPercent: "0", providerCommissionFixed: "0", sessionCount: "1", validityDays: "", branchId: "" };

export function ServicesModule() {
  const t = useTranslations("operationsRemaining");
  const locale = useLocale();
  const kinds = [
    { value: "single", label: t("kind.single") },
    { value: "package", label: t("kind.package") },
    { value: "subscription", label: t("kind.subscription") },
  ];

  const { data, error, loading, reload } = useLoad<{ services: Service[] }>("/api/ops/services");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<ServiceForm>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const action = useAction();

  useEffect(() => {
    void apiRequest<{ branches: Branch[] }>("/api/ops/branches")
      .then((value) => setBranches(value.branches))
      .catch(() => undefined);
  }, []);

  function update<K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) { setForm((old) => ({ ...old, [key]: value })); }

  function begin(service?: Service) {
    setEditing(service?.id ?? null);
    setForm(service ? { name: service.name, description: service.description ?? "", kind: service.kind, price: (service.priceMinor / 100).toFixed(2), durationMinutes: String(service.durationMinutes), providerCommissionMode: service.providerCommissionMode ?? "percentage", providerCommissionPercent: (service.providerCommissionBps / 100).toFixed(2), providerCommissionFixed: (service.providerCommissionFixedMinor / 100).toFixed(2), sessionCount: String(service.sessionCount), validityDays: service.validityDays ? String(service.validityDays) : "", branchId: service.branchId ?? "" } : blank);
    setOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { name: form.name, description: form.description || null, kind: form.kind, price: Number(form.price), durationMinutes: Number(form.durationMinutes), providerCommissionMode: form.providerCommissionMode, providerCommissionPercent: Number(form.providerCommissionPercent), providerCommissionFixed: Number(form.providerCommissionFixed), sessionCount: Number(form.sessionCount), validityDays: form.validityDays ? Number(form.validityDays) : null, branchId: form.branchId || null };
    const url = editing ? `/api/ops/services/${editing}` : "/api/ops/services";
    const message = editing ? t("messages.updated") : t("messages.created");
    const result = await action.execute(() => apiRequest(url, { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }), message);
    if (result) { setOpen(false); await reload(); }
  }

  async function archive(service: Service) {
    if (!window.confirm(t("confirm.archive", { name: service.name }))) return;
    const result = await action.execute(() => apiRequest(`/api/ops/services/${service.id}`, { method: "DELETE" }), t("messages.archived"));
    if (result) await reload();
  }

  return <section>
    <ModuleTitle
      eyebrow={t("module.eyebrow")}
      title={t("module.title")}
      description={t("module.description")}
      action={<Button onClick={() => begin()}><Plus size={17} /> {t("button.newService")}</Button>}
    />
    {error && <Notice>{String(error)}</Notice>}
    {action.error && <Notice>{action.error}</Notice>}
    {action.success && <Notice kind="success">{action.success}</Notice>}
    {loading ? <Loading /> : data?.services.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.services.map((service) => <article key={service.id} className={`rounded-2xl border bg-white p-5 ${service.isActive ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><Layers3 /></span>
          <span className={`rounded-full px-3 py-1 text-xs ${service.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{service.isActive ? t("status.active") : t("status.inactive")}</span>
        </div>
        <h2 className="mt-4 font-bold text-navy">{service.name}</h2>
        <p className="mt-1 min-h-10 text-sm text-slate-500">
          {service.description || (service.kind === "single" ? t("singleService") : (service.validityDays ? t("sessionsWithValidity", { count: service.sessionCount, validity: service.validityDays }) : t("sessionsOnly", { count: service.sessionCount })))}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-canvas p-3">
            <span className="block text-xs text-slate-500">{t("card.price")}</span>
            <strong className="mt-1 block text-navy">{formatMoney(service.priceMinor, locale)}</strong>
          </div>
          <div className="rounded-xl bg-canvas p-3">
            <span className="block text-xs text-slate-500">{t("card.durationAndCommissionLabel")}</span>
            <strong className="mt-1 block text-navy">{t("durationAndCommission", { minutes: service.durationMinutes, commission: service.providerCommissionBps / 100 })}</strong>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => begin(service)}><Pencil size={15} /> {t("button.edit")}</Button>
          {service.isActive && <Button size="sm" variant="ghost" onClick={() => void archive(service)}><Trash2 size={15} /> {t("button.disable")}</Button>}
        </div>
      </article>)}
    </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-semibold text-navy">{t("empty.title")}</p>
      <p className="mt-2 text-sm text-slate-500">{t("empty.description")}</p>
    </div>}
    <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}><RefreshCw size={15} /> {t("button.refresh")}</Button>

    {open && <Modal title={editing ? t("modal.editTitle") : t("modal.addTitle")} onClose={() => setOpen(false)}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <InputField label={t("form.name")} value={form.name} onChange={(v) => update("name", v)} required />
        <SelectField label={t("form.kind")} value={form.kind} onChange={(v) => { const kind = v as Service["kind"]; update("kind", kind); if (kind === "single") { update("sessionCount", "1"); update("validityDays", ""); } else if (form.sessionCount === "1") update("sessionCount", "5"); }} options={kinds} required />
        <InputField label={t("form.price")} value={form.price} onChange={(v) => update("price", v)} type="number" min="0" step="0.01" required />
        <InputField label={t("form.duration")} value={form.durationMinutes} onChange={(v) => update("durationMinutes", v)} type="number" min="5" max="1440" required />
        <InputField label={t("form.providerCommission")} value={form.providerCommissionPercent} onChange={(v) => update("providerCommissionPercent", v)} type="number" min="0" max="100" step="0.01" required />
        <SelectField label={t("form.branch")} value={form.branchId} onChange={(v) => update("branchId", v)} options={branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} />
        <InputField label={t("form.sessions")} value={form.sessionCount} onChange={(v) => update("sessionCount", v)} type="number" min={form.kind === "single" ? 1 : 2} max="1000" required />
        <InputField label={t("form.validity")} value={form.validityDays} onChange={(v) => update("validityDays", v)} type="number" min="1" max="3650" />
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">{t("form.description")}</span>
          <textarea value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={1000} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button disabled={action.busy} type="submit">{action.busy ? t("button.saving") : t("button.save")}</Button>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>{t("button.cancel")}</Button>
        </div>
        {action.error && <div className="sm:col-span-2"><Notice>{action.error}</Notice></div>}
      </form>
    </Modal>}
  </section>;
}
