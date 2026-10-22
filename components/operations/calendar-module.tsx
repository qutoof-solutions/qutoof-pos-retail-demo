"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addMinutes, endOfDay, endOfMonth, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { ar, enGB } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, InputField, Loading, Modal, Notice, SelectField } from "@/components/operations/shared";
import { APPOINTMENT_STATUSES, StatusBadge } from "@/components/operations/status";
import { buildWhatsAppWebUrl } from "@/lib/whatsapp/web";
import { useLocale, useTranslations } from "next-intl";
import type { Vertical } from "@/lib/terms";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type ViewMode = "day" | "week" | "month";
type Appointment = { id: string; branchId: string | null; customerId: string; customerName: string; customerPhone: string; serviceId: string; serviceName: string; providerId: string | null; providerName: string | null; startsAt: string; endsAt: string; status: keyof typeof APPOINTMENT_STATUSES; notes: string | null; cancellationReason: string | null; customerResponse: "confirmed" | "reschedule_requested" | null };
type Reference = { id: string; name: string; nameAr?: string; nameEn?: string; fullName?: string; phone?: string };
type FormState = { branchId: string; customerId: string; serviceId: string; providerId: string; startsAt: string; status: Appointment["status"]; notes: string; cancellationReason: string };
const initialForm = (): FormState => ({ branchId: "", customerId: "", serviceId: "", providerId: "", startsAt: "", status: "pending", notes: "", cancellationReason: "" });
const dateTimeLocal = (value: Date) => format(value, "yyyy-MM-dd'T'HH:mm");
const timeSlots = Array.from({ length: 25 }, (_, index) => 8 * 60 + index * 30);

export function CalendarModule({ canAssignProvider }: { canAssignProvider: boolean }) {
  const locale = useLocale();
  const dateLocale = locale === "ar" ? ar : enGB;
  const weekStartsOn = locale === "ar" ? 6 : 1;
  const intlLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }), [intlLocale]);
  const t = useTranslations("calendar");
  const statusT = useTranslations("statuses");
  const statusOptions = Object.entries(APPOINTMENT_STATUSES).map(([value, item]) => ({ value, label: statusT(item.labelKey) }));
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [branches, setBranches] = useState<Reference[]>([]);
  const [services, setServices] = useState<Reference[]>([]);
  const [customers, setCustomers] = useState<Reference[]>([]);
  const [providers, setProviders] = useState<Reference[]>([]);
  const [vertical, setVertical] = useState<Vertical>("medical");
  const [branchFilter, setBranchFilter] = useState("");
  const [form, setForm] = useState<FormState>(initialForm());
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState("");
  const range = useMemo(() => {
    const start = mode === "day" ? startOfDay(anchor) : mode === "month" ? startOfMonth(anchor) : startOfWeek(anchor, { weekStartsOn });
    const end = mode === "day" ? endOfDay(anchor) : mode === "month" ? endOfMonth(anchor) : endOfDay(addDays(start, 6));
    return { start, end };
  }, [mode, anchor, weekStartsOn]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from: range.start.toISOString(), to: addMinutes(range.end, 1).toISOString() });
      if (branchFilter) params.set("branchId", branchFilter);
      const [calendar, context, customerList] = await Promise.all([
        apiRequest<{ appointments: Appointment[] }>(`/api/ops/appointments?${params}`),
        apiRequest<{ branches: Reference[]; services: Reference[]; providers: Reference[]; vertical: Vertical }>("/api/ops/context"),
        apiRequest<{ customers: Reference[] }>("/api/ops/customers?limit=100"),
      ]);
      setAppointments(calendar.appointments); setBranches(context.branches); setServices(context.services); setProviders(context.providers); setCustomers(customerList.customers); setVertical(context.vertical);
      if (!form.branchId && context.branches[0]) setForm((old) => ({ ...old, branchId: context.branches[0]!.id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("loadError")); }
    finally { setLoading(false); }
  }, [range, branchFilter, form.branchId, t]);
  useEffect(() => { void load(); }, [load]);
  const days = useMemo(() => mode === "day" ? [startOfDay(anchor)] : mode === "month" ? Array.from({ length: endOfMonth(anchor).getDate() }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth(), index + 1)) : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor, { weekStartsOn }), index)), [mode, anchor, weekStartsOn]);
  function changeForm<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function startCreate(day = anchor) { setEditing(null); setForm({ ...initialForm(), branchId: branchFilter || branches[0]?.id || "", startsAt: dateTimeLocal(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0)) }); setModal(true); setError(""); }
  function startWalkIn() { setEditing(null); setForm({ ...initialForm(), branchId: branchFilter || branches[0]?.id || "", startsAt: dateTimeLocal(new Date()), status: "waiting" }); setModal(true); setError(""); }
  function startEdit(item: Appointment) { setEditing(item); setForm({ branchId: item.branchId ?? "", customerId: item.customerId, serviceId: item.serviceId, providerId: item.providerId ?? "", startsAt: dateTimeLocal(new Date(item.startsAt)), status: item.status, notes: item.notes ?? "", cancellationReason: item.cancellationReason ?? "" }); setModal(true); setError(""); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = { branchId: form.branchId, customerId: form.customerId, serviceId: form.serviceId, providerId: form.providerId || null, startsAt: new Date(form.startsAt).toISOString(), status: form.status, notes: form.notes || null, cancellationReason: form.cancellationReason || null };
      await apiRequest(editing ? `/api/ops/appointments/${editing.id}` : "/api/ops/appointments", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setModal(false); setNotice(editing ? t("appointmentUpdated") : t("appointmentCreated")); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("saveError")); }
    finally { setBusy(false); }
  }
  async function updateStatus(item: Appointment, status: keyof typeof APPOINTMENT_STATUSES) {
    setBusy(true); setError("");
    try { await apiRequest(`/api/ops/appointments/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setNotice(t("statusUpdated")); await load(); }
    catch { setError(t("statusUpdateError")); }
    finally { setBusy(false); }
  }
  async function moveAppointment(id: string, day: Date, minutes: number, targetProviderId?: string | null) {
    const item = appointments.find((candidate) => candidate.id === id);
    if (!item || !["pending", "confirmed"].includes(item.status)) return;
    const startsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    const providerId = targetProviderId === undefined ? item.providerId : targetProviderId;
    setBusy(true); setError("");
    try { await apiRequest(`/api/ops/appointments/${item.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: startsAt.toISOString(), providerId }) }); setNotice(`${t("appointmentMovedTo")} ${format(startsAt, "EEEE d MMM · HH:mm", { locale: dateLocale })}${providerId ? ` · ${providers.find((provider) => provider.id === providerId)?.fullName ?? t("provider")}` : ` · ${t("withoutProvider")}`}`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("moveError")); }
    finally { setBusy(false); setDraggingId(""); }
  }
  async function assignProvider(item: Appointment, providerId: string) {
    setBusy(true); setError("");
    try { await apiRequest(`/api/ops/appointments/${item.id}`, { method: "PATCH", body: JSON.stringify({ providerId: providerId || null }) }); setNotice(t("providerUpdated")); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("providerAssignError")); }
    finally { setBusy(false); }
  }
  function step(direction: number) { setAnchor((value) => mode === "month" ? new Date(value.getFullYear(), value.getMonth() + direction, 1) : addDays(value, direction * (mode === "day" ? 1 : 7))); }

  return <section>
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={t("previous")} onClick={() => step(-1)}><ChevronRight size={18} /></Button><Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>{t("today")}</Button><Button variant="outline" size="icon" aria-label={t("next")} onClick={() => step(1)}><ChevronLeft size={18} /></Button></div><strong className="min-w-48 text-center text-sm text-navy">{mode === "day" ? format(anchor, "EEEE d MMMM yyyy", { locale: dateLocale }) : mode === "month" ? format(anchor, "MMMM yyyy", { locale: dateLocale }) : `${format(range.start, "d MMM", { locale: dateLocale })} — ${format(range.end, "d MMM yyyy", { locale: dateLocale })}`}</strong><div className="mr-auto flex gap-1 rounded-xl bg-slate-100 p-1"><button className={`rounded-lg px-3 py-1.5 text-sm ${mode === "day" ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`} onClick={() => setMode("day")}>{t("day")}</button><button className={`rounded-lg px-3 py-1.5 text-sm ${mode === "week" ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`} onClick={() => setMode("week")}>{t("week")}</button><button className={`rounded-lg px-3 py-1.5 text-sm ${mode === "month" ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`} onClick={() => setMode("month")}>{t("month")}</button><Button size="sm" variant="outline" onClick={startWalkIn}><Plus size={15} /> {t("walkIn")}</Button></div>{branches.length > 0 && <div className="w-48"><SelectField label="" value={branchFilter} onChange={setBranchFilter} options={[{ value: "", label: t("allBranches") }, ...branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))]} /></div>}<Button size="icon" variant="ghost" aria-label={t("refresh")} onClick={() => void load()}><RefreshCw size={17} /></Button></div>
    {error && !modal && <Notice>{error}</Notice>}{notice && <div className="mb-3"><Notice kind="success">{notice}</Notice></div>}
    {loading ? <Loading /> : appointments.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><CalendarDays className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-navy">{t("noAppointments")}</p><p className="mt-1 text-sm text-slate-500">{t("noAppointmentsHelp")}</p></div> : <div className={`grid gap-3 ${mode === "day" ? "grid-cols-1" : mode === "month" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" : "md:grid-cols-2 xl:grid-cols-4"}`}>{days.map((day) => {
      const list = appointments.filter((item) => { const itemDate = new Date(item.startsAt); return itemDate >= startOfDay(day) && itemDate < addDays(startOfDay(day), 1); });
      return <section key={day.toISOString()} className="min-h-52 overflow-hidden rounded-2xl border border-slate-200 bg-white"><header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><div><p className="text-xs text-slate-500">{format(day, "EEEE", { locale: dateLocale })}</p><strong className="text-sm text-navy">{format(day, "d MMMM", { locale: dateLocale })}</strong></div><Button variant="ghost" size="icon" aria-label={t("addAppointmentForDay")} onClick={() => startCreate(day)}><Plus size={17} /></Button></header><div className="space-y-2 p-3">{list.map((item) => { const whatsappMessage = `${t("whatsappGreeting")} ${item.customerName}، ${t("whatsappReminder")} ${item.serviceName} ${t("whatsappOn")} ${format(new Date(item.startsAt), "EEEE d MMMM · HH:mm", { locale: dateLocale })}.`; const whatsappUrl = buildWhatsAppWebUrl(item.customerPhone, whatsappMessage); return <article key={item.id} className="rounded-xl border border-slate-100 p-3 transition hover:border-teal/30"><div draggable={item.status === "pending" || item.status === "confirmed"} onDragStart={(event) => { setDraggingId(item.id); event.dataTransfer.setData("text/plain", item.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggingId("")} className={`flex items-start gap-2 ${item.status === "pending" || item.status === "confirmed" ? "cursor-grab active:cursor-grabbing" : ""}`}><GripVertical size={16} className="mt-1 shrink-0 text-slate-400" /><button className="min-w-0 flex-1 text-right" onClick={() => startEdit(item)}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-navy">{timeFormatter.format(new Date(item.startsAt))} · {item.customerName}</strong><StatusBadge status={item.status} patientFlow={vertical === "medical"} /></div><p className="mt-1 text-xs text-slate-600">{item.serviceName}{item.providerName ? ` · ${item.providerName}` : ""}</p><p className="mt-1 text-xs text-slate-400">{item.customerPhone}</p></button></div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><a className="text-xs font-semibold text-teal underline" href={`/api/ops/appointments/${item.id}/ics`}>{t("exportIcs")}</a>{whatsappUrl && <a className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 underline" href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle size={13} /> {t("openWhatsApp")}</a>}</div>{item.customerResponse === "reschedule_requested" && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">{t("rescheduleRequested")}</p>}{canAssignProvider && (item.status === "pending" || item.status === "confirmed") && <label className="mt-2 block text-xs text-slate-500">{t("provider")}<select aria-label={t("providerForAppointment")} disabled={busy} value={item.providerId ?? ""} onChange={(event) => void assignProvider(item, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-navy"><option value="">{t("unassigned")}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.fullName ?? provider.name}</option>)}</select></label>}<>{canAssignProvider && <div className="mt-2 flex flex-wrap gap-1">{item.status === "pending" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void updateStatus(item, "confirmed")}>{t("confirm")}</Button>}{item.status === "confirmed" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void updateStatus(item, "waiting")}>{vertical === "medical" ? t("checkIn") : t("moveToWaiting")}</Button>}{(item.status === "waiting" || item.status === "in_progress") && <Button variant="outline" size="sm" disabled={busy} onClick={() => void updateStatus(item, item.status === "waiting" ? "in_progress" : "completed")}>{item.status === "waiting" ? vertical === "medical" ? t("enterRoom") : t("startService") : vertical === "medical" ? t("completeVisit") : t("complete")}</Button>}</div>}</></article>; })}</div><details className="border-t border-slate-100 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-teal">{t("dragAppointment")}</summary><div className="mt-2 grid grid-cols-3 gap-1">{timeSlots.map((minutes) => <div key={minutes} role="button" tabIndex={0} onDragOver={(event) => { if (draggingId) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) void moveAppointment(id, day, minutes); }} className="rounded-md border border-dashed border-slate-200 px-1 py-1.5 text-center text-[11px] text-slate-600 hover:border-teal hover:bg-teal/5">{String(Math.floor(minutes / 60)).padStart(2, "0")}:{String(minutes % 60).padStart(2, "0")}</div>)}</div><div className="mt-3 border-t border-slate-100 pt-3"><p className="mb-2 text-xs font-semibold text-slate-600">{t("providerLanes")}</p><div className="grid gap-2 sm:grid-cols-2">{[{ id: "", name: t("unassigned") }, ...providers.map((provider) => ({ id: provider.id, name: provider.fullName ?? provider.name }))].map((provider) => <div key={provider.id || "unassigned"} onDragOver={(event) => { if (draggingId) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); const item = appointments.find((candidate) => candidate.id === id); if (item) void moveAppointment(id, day, new Date(item.startsAt).getHours() * 60 + new Date(item.startsAt).getMinutes(), provider.id || null); }} className="min-h-12 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600 transition hover:border-teal hover:bg-teal/5">{provider.name} · {t("dropZone")}</div>)}</div></div></details></section>;
    })}</div>}
    {modal && <Modal title={editing ? t("editAppointment") : form.status === "waiting" ? t("immediateWalkIn") : t("addAppointment")} onClose={() => setModal(false)}><form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><SelectField label={t("branch")} value={form.branchId} onChange={(value) => changeForm("branchId", value)} options={branches.map((item) => ({ value: item.id, label: item.name }))} required /><SelectField label={t("customer")} value={form.customerId} onChange={(value) => changeForm("customerId", value)} options={customers.map((item) => ({ value: item.id, label: `${item.fullName} · ${item.phone}` }))} required /><SelectField label={t("service")} value={form.serviceId} onChange={(value) => changeForm("serviceId", value)} options={services.map((item) => ({ value: item.id, label: item.name }))} required /><SelectField label={t("provider")} value={form.providerId} onChange={(value) => changeForm("providerId", value)} options={[{ value: "", label: t("unassigned") }, ...providers.map((item) => ({ value: item.id, label: item.fullName ?? item.name }))]} /><InputField label={t("appointmentDateTime")} type="datetime-local" value={form.startsAt} onChange={(value) => changeForm("startsAt", value)} required /><SelectField label={t("status")} value={form.status} onChange={(value) => changeForm("status", value as Appointment["status"])} options={editing ? statusOptions : statusOptions.filter((option) => option.value === "pending" || option.value === "confirmed" || option.value === "waiting")} />{form.status === "cancelled" && <InputField label={t("cancellationReason")} value={form.cancellationReason} onChange={(value) => changeForm("cancellationReason", value)} required />}<label className="block sm:col-span-2"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("notes")}</span><textarea value={form.notes} onChange={(event) => changeForm("notes", event.target.value)} maxLength={1500} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" /></label><div className="flex gap-2 sm:col-span-2"><Button disabled={busy} type="submit">{busy ? t("saving") : editing ? t("saveChanges") : t("createAppointment")}</Button><Button variant="outline" type="button" onClick={() => setModal(false)}>{t("cancel")}</Button></div>{error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}</form></Modal>}
  </section>;
}
