"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, MonitorPlay, PhoneCall, RefreshCw, SkipForward, Ticket, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate, Loading, ModuleTitle, Notice, SelectField } from "@/components/operations/shared";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type TicketRow = { id: string; ticketNumber: number; displayLabel: string; status: "waiting" | "called" | "serving" | "completed" | "skipped"; appointmentId: string | null; customerName: string | null; issuedAt: string };
type AppointmentRow = { id: string; customerName: string; serviceName: string; status: string; startsAt: string };

export function QueueModule({ clinical = false }: { clinical?: boolean }) {
  const t = useTranslations("queue-gate-attendance");
  const locale = useLocale();
  const intlLocale = locale === "en" ? "en-GB" : "ar-EG";
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [appointmentId, setAppointmentId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void apiRequest<{ branches: Branch[] }>("/api/ops/branches").then((result) => {
      setBranches(result.branches);
      setBranchId(result.branches[0]?.id ?? "");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : t("queue.errors.loadBranches")));
  }, [t]);

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [queue, calendar] = await Promise.all([
        apiRequest<{ tickets: TicketRow[] }>(`/api/ops/queue?branchId=${encodeURIComponent(branchId)}`),
        apiRequest<{ appointments: AppointmentRow[] }>(`/api/ops/appointments?branchId=${encodeURIComponent(branchId)}&from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 3 * 86_400_000).toISOString()}`),
      ]);
      setTickets(queue.tickets);
      setAppointments(calendar.appointments.filter((item) => ["pending", "confirmed"].includes(item.status) && !queue.tickets.some((ticket) => ticket.appointmentId === item.id)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("queue.errors.loadQueue")); }
    finally { setLoading(false); }
  }, [branchId, t]);

  useEffect(() => { void load(); }, [load]);

  async function post(payload: Record<string, string>) {
    setBusy(true); setError(""); setMessage("");
    try {
      await apiRequest("/api/ops/queue", { method: "POST", body: JSON.stringify({ branchId, ...payload }) });
      setMessage(t("queue.messages.updated"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("queue.errors.action")); }
    finally { setBusy(false); }
  }

  const current = tickets.find((ticket) => ticket.status === "serving") ?? tickets.find((ticket) => ticket.status === "called");
  const waiting = tickets.filter((ticket) => ticket.status === "waiting");
  const statusLabel: Record<TicketRow["status"], string> = {
    waiting: t("queue.status.waiting"),
    called: t("queue.status.called"),
    serving: t("queue.status.serving"),
    completed: t("queue.status.completed"),
    skipped: t("queue.status.skipped"),
  };

  return <section>
    <ModuleTitle eyebrow={t("queue.eyebrow")} title={t("queue.title")} description={clinical ? t("queue.descriptionClinical") : t("queue.description")} />
    {branches.length > 0 && <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="w-full max-w-sm"><SelectField label={t("queue.branch")} value={branchId} onChange={setBranchId} options={branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} /></div>
      <Button variant="outline" onClick={() => void load()}><RefreshCw size={16} /> {t("queue.refresh")}</Button>
      <Button variant="outline" onClick={() => window.open(`/queue/${branchId}`, "_blank", "noopener,noreferrer")} disabled={!branchId}><MonitorPlay size={16} /> {t("queue.openDisplay")} <ArrowUpRight size={14} /></Button>
    </div>}
    {branches.length === 0 && !loading && <Notice kind="info">{t("queue.noBranches")}</Notice>}
    {error && <Notice>{error}</Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    {loading ? <Loading /> : branchId && <>
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{t("queue.currentTurn")}</p><strong className="mt-2 block text-4xl font-bold text-teal">{current?.ticketNumber ? new Intl.NumberFormat(intlLocale).format(current.ticketNumber) : "—"}</strong><p className="mt-1 text-sm text-slate-600">{current ? `${statusLabel[current.status]}${current.customerName ? ` · ${current.customerName}` : ""}` : t("queue.noCurrentTurn")}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{t("queue.waitingCount")}</p><strong className="mt-2 block text-4xl font-bold text-navy">{new Intl.NumberFormat(intlLocale).format(waiting.length)}</strong><p className="mt-1 text-sm text-slate-600">{clinical ? t("queue.waitingAssigned") : t("queue.activeTickets")}</p></article>
        {!clinical && <article className="flex flex-col justify-between rounded-2xl border border-teal/20 bg-teal/5 p-5"><div><p className="text-sm font-semibold text-teal">{t("queue.issueNew")}</p><p className="mt-1 text-xs text-slate-600">{t("queue.registeredAppointments")}</p></div><div className="mt-3 flex gap-2"><select value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-xs"><option value="">{t("queue.chooseAppointment")}</option>{appointments.map((item) => <option key={item.id} value={item.id}>{item.customerName} · {item.serviceName}</option>)}</select><Button size="sm" disabled={!appointmentId || busy} onClick={() => void post({ action: "issue", appointmentId })}><Ticket size={15} /> {t("queue.issue")}</Button></div></article>}
      </div>
      <div className="my-4 flex flex-wrap gap-2">
        {!clinical && !current && <Button disabled={busy || waiting.length === 0} onClick={() => void post({ action: "call_next" })}><PhoneCall size={17} /> {t("queue.callNext")}</Button>}
        {current?.status === "called" && <Button disabled={busy} onClick={() => void post({ action: "start", ticketId: current.id })}><UserRound size={17} /> {t("queue.startService")}</Button>}
        {current && <Button variant="outline" disabled={busy} onClick={() => void post({ action: "complete", ticketId: current.id })}><CheckCircle2 size={17} /> {t("queue.completeTurn")}</Button>}
        {!clinical && current && <Button variant="outline" disabled={busy} onClick={() => void post({ action: "skip", ticketId: current.id })}><SkipForward size={17} /> {t("queue.skipTurn")}</Button>}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[.6fr_1.4fr_1fr_1fr] gap-2 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600"><span>{t("queue.turn")}</span><span>{t("queue.nameStaffOnly")}</span><span>{t("queue.status")}</span><span>{t("queue.issuedAt")}</span></div>
        {tickets.map((ticket) => <div key={ticket.id} className="grid grid-cols-[.6fr_1.4fr_1fr_1fr] items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm"><strong className="text-lg text-navy">{new Intl.NumberFormat(intlLocale).format(ticket.ticketNumber)}</strong><span className="flex items-center gap-2 text-slate-700">{ticket.customerName || "—"}</span><span className="text-xs text-slate-600">{statusLabel[ticket.status]}</span><span className="text-xs text-slate-500">{formatDate(ticket.issuedAt, true, locale)}</span></div>)}
        {tickets.length === 0 && <p className="p-8 text-center text-sm text-slate-500">{t("queue.noTickets")}</p>}
      </div>
    </>}
  </section>;
}
