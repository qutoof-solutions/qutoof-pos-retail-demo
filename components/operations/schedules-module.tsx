"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarOff, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { localizedBranchName } from "@/lib/i18n/branch-name";
import { schedulePersonRoleTranslationKey } from "@/lib/operations/scheduling";
import { Button } from "@/components/ui/button";
import { apiRequest, InputField, Loading, Modal, ModuleTitle, Notice, SelectField, useAction } from "@/components/operations/shared";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type Provider = { id: string; fullName: string; role: string };
type Break = { start: string; end: string };
type DayRow = { weekday: number; startsAt: string; endsAt: string; breakText: string; isAvailable: boolean };
type ScheduleRecord = { weekday: number; startsAt: string; endsAt: string; breaks: Break[]; isAvailable: boolean };
type ExceptionRecord = { id: string; date: string; startsAt: string | null; endsAt: string | null; reason: string; isEmergency: boolean; providerId?: string | null };

function formatScheduleDate(value: string, locale: string) { const [year, month, day] = value.split("-").map(Number); return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!, 12))); }

export function SchedulesModule() {
  const t = useTranslations("operationsRemaining");
  const { locale } = useDataLocale();

  const weekdays = useMemo(() => [
    t("weekday.sunday"),
    t("weekday.monday"),
    t("weekday.tuesday"),
    t("weekday.wednesday"),
    t("weekday.thursday"),
    t("weekday.friday"),
    t("weekday.saturday"),
  ], [t]);
  const initialRows = useMemo(() => weekdays.map((_, weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00", breakText: "", isAvailable: weekday !== 5 })), [weekdays]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [branchId, setBranchId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [rows, setRows] = useState<DayRow[]>(initialRows);
  const [exceptions, setExceptions] = useState<ExceptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [isEmergency, setIsEmergency] = useState(true);
  const action = useAction();

  function personRoleLabel(role: string): string {
    const key = schedulePersonRoleTranslationKey(role);
    const translator = t as unknown as ((name: string) => string) & { has?: (name: string) => boolean };
    if (translator.has?.(key)) return translator(key);
    if (locale === "ar") return role === "doctor" ? "طبيب" : role === "specialist" ? "أخصائي" : role === "provider" ? "مقدم خدمة" : "موظف";
    return role === "doctor" ? "Doctor" : role === "specialist" ? "Specialist" : role === "provider" ? "Provider" : "Employee";
  }

  useEffect(() => {
    void apiRequest<{ branches: Branch[] }>("/api/ops/branches")
      .then((result) => {
        setBranches(result.branches);
        setBranchId(result.branches[0]?.id ?? "");
      })
      .catch((cause) => setLoadError(cause instanceof Error ? cause.message : t("errors.loadBranches")));
  }, [t]);

  function parseBreaks(value: string): Break[] {
    if (!value.trim()) return [];
    return value.split(",").map((piece) => {
      const [start, end] = piece.trim().split("-").map((part) => part.trim());
      if (!start || !end) throw new Error(t("errors.breaksFormat"));
      return { start, end };
    });
  }

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setLoadError("");
    try {
      const [scheduleResult, exceptionResult] = await Promise.all([
        apiRequest<{ schedules: ScheduleRecord[]; providers: Provider[]; people?: Provider[] }>(`/api/ops/schedules?branchId=${encodeURIComponent(branchId)}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}`),
        apiRequest<{ exceptions: ExceptionRecord[] }>(`/api/ops/schedules/exceptions?branchId=${encodeURIComponent(branchId)}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}`),
      ]);
      setProviders(scheduleResult.people ?? scheduleResult.providers);
      const map = new Map(scheduleResult.schedules.map((row) => [row.weekday, row]));
      setRows(initialRows.map((row) => {
        const saved = map.get(row.weekday);
        return saved ? { weekday: row.weekday, startsAt: saved.startsAt, endsAt: saved.endsAt, breakText: saved.breaks.map((item) => `${item.start}-${item.end}`).join(", "), isAvailable: saved.isAvailable } : row;
      }));
      setExceptions(exceptionResult.exceptions);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t("errors.loadSchedules"));
    } finally {
      setLoading(false);
    }
  }, [branchId, providerId, initialRows, t]);

  useEffect(() => { void load(); }, [load]);

  function setRow(weekday: number, patch: Partial<DayRow>) { setRows((current) => current.map((row) => row.weekday === weekday ? { ...row, ...patch } : row)); }

  async function saveSchedule() {
    const normalized = rows.map(({ weekday, startsAt: start, endsAt: end, breakText, isAvailable }) => ({ weekday, startsAt: start, endsAt: end, isAvailable, breaks: parseBreaks(breakText) }));
    const result = await action.execute(() => apiRequest("/api/ops/schedules", { method: "PUT", body: JSON.stringify({ branchId, providerId: providerId || null, rows: normalized }) }), t("notices.savedSchedule"));
    if (result) await load();
  }
  async function addException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/schedules/exceptions", { method: "POST", body: JSON.stringify({ branchId, providerId: providerId || null, date, startsAt: startsAt || null, endsAt: endsAt || null, reason, isEmergency }) }), isEmergency ? t("notices.savedEmergencyClose") : t("notices.savedException"));
    if (result) { setModalOpen(false); setReason(""); setStartsAt(""); setEndsAt(""); await load(); }
  }
  async function removeException(id: string) {
    const result = await action.execute(() => apiRequest(`/api/ops/schedules/exceptions?id=${encodeURIComponent(id)}`, { method: "DELETE" }), t("notices.deletedException"));
    if (result) await load();
  }

  return <section dir={locale === "ar" ? "rtl" : "ltr"}>
    <ModuleTitle
      eyebrow={t("module.eyebrow")}
      title={t("module.title")}
      description={t("module.description")}
      action={<Button disabled={!branchId} onClick={() => setModalOpen(true)}><CalendarOff size={17} /> {t("buttons.exceptionalClose")}</Button>}
    />
    {loadError && <Notice>{loadError}</Notice>}
    {!loading && !branches.length && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{t("empty.noBranches")} <Link className="font-bold underline" href="/dashboard/branches">{t("links.openBranchesManagement")}</Link></div>}
    {!!branches.length && <>
      <div className="mb-4 grid max-w-3xl gap-3 sm:grid-cols-2">
        <SelectField label={t("select.branch")} value={branchId} onChange={(value) => { setBranchId(value); setProviderId(""); }} options={branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} />
        <SelectField label={t("select.provider")} value={providerId} onChange={setProviderId} options={[{ value: "", label: t("select.allProviders") }, ...providers.map((provider) => ({ value: provider.id, label: `${provider.fullName} · ${personRoleLabel(provider.role)}` }))]} />
      </div>
      {loading ? <Loading /> : <div className="space-y-4">
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <div className="min-w-[780px]">
            <div className="grid grid-cols-[1.05fr_1fr_1fr_1.5fr_.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
              <span>{t("table.header.day")}</span>
              <span>{t("table.header.from")}</span>
              <span>{t("table.header.to")}</span>
              <span>{t("table.header.breaks")}</span>
              <span>{t("table.header.status")}</span>
            </div>
            {rows.map((row) => <div key={row.weekday} className="grid grid-cols-[1.05fr_1fr_1fr_1.5fr_.8fr] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
              <strong className="text-sm text-navy">{weekdays[row.weekday]}</strong>
              <input aria-label={`${t("aria.startOfDay")} ${weekdays[row.weekday]}`} type="time" lang={locale === "ar" ? "ar-EG" : "en-GB"} dir={locale === "ar" ? "rtl" : "ltr"} value={row.startsAt} onChange={(event) => setRow(row.weekday, { startsAt: event.target.value })} className="h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <input aria-label={`${t("aria.endOfDay")} ${weekdays[row.weekday]}`} type="time" lang={locale === "ar" ? "ar-EG" : "en-GB"} dir={locale === "ar" ? "rtl" : "ltr"} value={row.endsAt} onChange={(event) => setRow(row.weekday, { endsAt: event.target.value })} className="h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <input aria-label={`${t("aria.breaks")} ${weekdays[row.weekday]}`} placeholder={t("placeholder.breakExample")} value={row.breakText} onChange={(event) => setRow(row.weekday, { breakText: event.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={row.isAvailable} onChange={(event) => setRow(row.weekday, { isAvailable: event.target.checked })} />
                {t("status.open")}
              </label>
            </div>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={action.busy} onClick={() => void saveSchedule()}><Save size={17} /> {t("buttons.saveWeekSchedule")}</Button>
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {action.error && <Notice>{action.error}</Notice>}
        </div>
      </div>}
    </>}
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="text-amber-600" size={19} />
        <h2 className="font-bold text-navy">{t("headings.upcomingExceptions")}</h2>
      </div>
      {exceptions.length ? <div className="space-y-2">
        {exceptions.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <span className={`rounded-full px-2.5 py-1 text-xs ${item.isEmergency ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{item.isEmergency ? t("status.emergency") : t("status.exception")}</span>
          <strong className="text-sm text-navy">{formatScheduleDate(item.date, locale)}</strong>
          <span className="text-sm text-slate-600">{item.providerId ? providers.find((provider) => provider.id === item.providerId)?.fullName ?? t("select.provider") : t("select.allProviders")} · {item.startsAt ? `${item.startsAt}–${item.endsAt}` : t("labels.closedWholeDay")} · {item.reason}</span>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => void removeException(item.id)}><Trash2 size={15} /> {t("buttons.delete")}</Button>
        </article>)}
      </div> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">{t("empty.noExceptions")}</p>}
    </section>
    {modalOpen && <Modal title={t("modal.title")} onClose={() => setModalOpen(false)}>
      <form onSubmit={addException} className="space-y-4">
        <InputField label={t("input.date")} type="date" lang={locale === "ar" ? "ar-EG" : "en-GB"} dir={locale === "ar" ? "rtl" : "ltr"} value={date} onChange={setDate} required />
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={isEmergency} onChange={(event) => setIsEmergency(event.target.checked)} />
          {t("modal.checkboxEmergencyLabel")}
        </label>
        <p className="text-xs text-slate-500">{t("helper.leaveTimesBlank")}</p>
        <div className="grid grid-cols-2 gap-3">
          <InputField label={t("input.fromOptional")} type="time" value={startsAt} onChange={setStartsAt} />
          <InputField label={t("input.toOptional")} type="time" value={endsAt} onChange={setEndsAt} />
        </div>
        <InputField label={t("input.reason")} value={reason} onChange={setReason} required />
        <div className="flex gap-2">
          <Button disabled={action.busy} type="submit"><Plus size={16} /> {t("buttons.save")}</Button>
          <Button variant="outline" type="button" onClick={() => setModalOpen(false)}>{t("buttons.cancel")}</Button>
        </div>
        {action.error && <Notice>{action.error}</Notice>}
      </form>
    </Modal>}
  </section>;
}
