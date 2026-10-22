"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest, EmptyState, InputField, Loading, ModuleTitle, Notice, SelectField, useAction, useLoad } from "@/components/operations/shared";

type Item = { id: string; name: string; sku: string; unitCode: string; quantityScale: number; isActive: number };
type Warehouse = { id: string; name: string; branchId: string | null; isActive: number };
type InventoryData = { items: Item[]; warehouses: Warehouse[] };
type Service = { id: string; name: string; branchId: string | null };
type ContextData = { services: Service[] };
type Material = { id: string; serviceId: string; serviceName: string; itemId: string; sku: string; itemName: string; warehouseId: string | null; warehouseName: string | null; quantityPerServiceUnits: number; quantityScale: number; unitCode: string; isActive: number };
type MaterialData = { materials: Material[] };

export function ServiceMaterialsModule() {
  const t = useTranslations("operationsRemaining");
  const locale = useLocale();
  const intlLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  const [refreshKey, setRefreshKey] = useState(0);
  const inventory = useLoad<InventoryData>("/api/ops/inventory", refreshKey);
  const context = useLoad<ContextData>("/api/ops/context", refreshKey);
  const materials = useLoad<MaterialData>("/api/ops/inventory/materials", refreshKey);
  const [form, setForm] = useState({ serviceId: "", itemId: "", warehouseId: "", quantityPerService: "" });
  const action = useAction();
  const items = inventory.data?.items.filter((item) => item.isActive) ?? [];
  const warehouses = inventory.data?.warehouses.filter((warehouse) => warehouse.isActive) ?? [];
  const selectedItem = items.find((item) => item.id === form.itemId);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/inventory/materials", { method: "POST", body: JSON.stringify({ ...form, quantityPerService: Number(form.quantityPerService) }) }), t("success.saved"));
    if (result) { setForm({ serviceId: "", itemId: "", warehouseId: "", quantityPerService: "" }); setRefreshKey((n) => n + 1); }
  }
  async function disable(id: string) {
    const result = await action.execute(() => apiRequest(`/api/ops/inventory/materials?id=${encodeURIComponent(id)}`, { method: "DELETE" }), t("success.disabled"));
    if (result) setRefreshKey((n) => n + 1);
  }
  const unitLabelDefault = selectedItem?.unitCode ?? t("common.unit");
  return <div>
    <ModuleTitle eyebrow={t("module.eyebrow")} title={t("module.title")} description={t("module.description")} />
    <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">{t("warning.branchNote")}</div>
    {(inventory.error || context.error || materials.error || action.error) && <Notice>{inventory.error || context.error || materials.error || action.error}</Notice>}{action.success && <div className="mb-4"><Notice kind="success">{action.success}</Notice></div>}
    <form onSubmit={save} className="mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-4"><SelectField label={t("select.service")} value={form.serviceId} onChange={(value) => setForm({ ...form, serviceId: value })} options={(context.data?.services ?? []).map((service) => ({ value: service.id, label: service.name }))} required /><SelectField label={t("select.item")} value={form.itemId} onChange={(value) => setForm({ ...form, itemId: value })} options={items.map((item) => ({ value: item.id, label: `${item.name} · ${item.sku}` }))} required /><SelectField label={t("select.warehouse")} value={form.warehouseId} onChange={(value) => setForm({ ...form, warehouseId: value })} options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} required /><InputField label={t("input.quantityPerService", { unit: unitLabelDefault })} value={form.quantityPerService} onChange={(value) => setForm({ ...form, quantityPerService: value })} type="number" min={selectedItem ? 1 / (10 ** selectedItem.quantityScale) : 0.0001} step={selectedItem ? 1 / (10 ** selectedItem.quantityScale) : "any"} required /><div className="md:col-span-4"><Button type="submit" disabled={action.busy || !items.length || !warehouses.length || !context.data?.services.length}>{action.busy ? t("button.saving") : t("button.saveLink")}</Button></div></form>
    <h2 className="mb-3 text-lg font-bold text-navy">{t("heading.currentRecipes")}</h2>{materials.loading ? <Loading /> : !materials.data?.materials.length ? <EmptyState title={t("empty.title")} detail={t("empty.detail")} /> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-full text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">{t("table.service")}</th><th className="p-3">{t("table.item")}</th><th className="p-3">{t("table.warehouse")}</th><th className="p-3">{t("table.quantity")}</th><th className="p-3">{t("table.action")}</th></tr></thead><tbody>{materials.data.materials.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{row.serviceName}</td><td className="p-3">{row.itemName}<span className="block text-xs text-slate-500">{row.sku}</span></td><td className="p-3">{row.warehouseName ?? t("table.unassigned")}</td><td className="p-3">{new Intl.NumberFormat(intlLocale, { maximumFractionDigits: row.quantityScale }).format(row.quantityPerServiceUnits / (10 ** row.quantityScale))} {row.unitCode}</td><td className="p-3"><Button size="sm" variant="outline" disabled={action.busy} onClick={() => void disable(row.id)}>{t("button.disable")}</Button></td></tr>)}</tbody></table></div>}
  </div>;
}
