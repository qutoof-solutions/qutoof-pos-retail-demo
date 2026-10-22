"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiRequest, InputField, Notice } from "@/components/operations/shared";
import { Button } from "@/components/ui/button";

type Session = { id: string; membershipId: string | null; totalSessions: number; usedSessions: number; trainerId: string | null; branchId: string | null; createdAt: string };
type Usage = { id: string; sessionId: string; consumedAt: string; appointmentId: string | null; idempotencyKey: string };
type Measurement = { id: string; recordedAt: string; weightKg: number | null; bodyFatBps: number | null; muscleKg: number | null; bmiBps: number | null };
type Membership = { id: string; startsAt: string; endsAt: string; status: string; planNameSnapshot: string };
type GymResult = { ptSessions: Session[]; ptSessionUsages: Usage[]; measurements: Measurement[]; memberships: Membership[] };

function operationKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }

export function GymPtPanel({ customerId, memberships, canWrite }: { customerId: string; memberships: Membership[]; canWrite: boolean }) {
  const t = useTranslations("register");
  const locale = useLocale();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [usages, setUsages] = useState<Usage[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [membershipRows, setMembershipRows] = useState<Membership[]>(memberships);
  const [membershipId, setMembershipId] = useState(memberships[0]?.id ?? "");
  const [totalSessions, setTotalSessions] = useState("1");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [muscleKg, setMuscleKg] = useState("");
  const [bmi, setBmi] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }), [locale]);
  const membershipById = useMemo(() => new Map(membershipRows.map((membership) => [membership.id, membership])), [membershipRows]);

  const load = useCallback(async () => {
    const result = await apiRequest<GymResult>(`/api/ops/customers/${customerId}/gym`);
    setSessions(result.ptSessions); setUsages(result.ptSessionUsages); setMeasurements(result.measurements);
    setMembershipRows(result.memberships.length ? result.memberships : memberships);
    setMembershipId((current) => current || result.memberships[0]?.id || memberships[0]?.id || "");
  }, [customerId, memberships]);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : t("gymLoadFailed"))); }, [load, t]);

  async function post(body: unknown) {
    setBusy(true); setError(""); setMessage("");
    try { await apiRequest(`/api/ops/customers/${customerId}/gym`, { method: "POST", body: JSON.stringify(body) }); await load(); setMessage(t("gymSaved")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("gymSaveFailed")); }
    finally { setBusy(false); }
  }
  function membershipIsValid(membershipId: string | null) {
    if (!membershipId) return true;
    const membership = membershipById.get(membershipId);
    if (!membership) return false;
    const now = Date.now();
    return membership.status === "active" && new Date(membership.startsAt).getTime() <= now && new Date(membership.endsAt).getTime() > now;
  }
  const formatMembership = (membership: Membership) => `${membership.planNameSnapshot} · ${dateFormatter.format(new Date(membership.startsAt))} – ${dateFormatter.format(new Date(membership.endsAt))}`;

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <h3 className="font-bold text-navy dark:text-white">{t("gymTools")}</h3>
    {error && <div className="mt-3"><Notice>{error}</Notice></div>}{message && <p className="mt-3 text-sm text-teal">{message}</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <form className="rounded-xl bg-slate-50 p-4" onSubmit={(event) => { event.preventDefault(); void post({ kind: "pt", action: "create", membershipId: membershipId || null, totalSessions: Number(totalSessions), idempotencyKey: operationKey("gym-pt-create") }); }}>
        <h4 className="font-semibold">{t("ptEntitlement")}</h4><p className="mt-1 text-xs text-slate-500">{t("membershipValidityHelp")}</p>
        <label className="mt-3 block text-sm">{t("membership")}<select value={membershipId} onChange={(event) => setMembershipId(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">{t("standalonePt")}</option>{membershipRows.map((membership) => <option key={membership.id} value={membership.id}>{formatMembership(membership)}</option>)}</select></label>
        <InputField label={t("totalSessions")} type="number" min="1" max="1000" value={totalSessions} onChange={setTotalSessions} />
        <Button className="mt-3" type="submit" disabled={busy || !canWrite}>{t("addPtSessions")}</Button>
        <div className="mt-4 space-y-2">{sessions.map((session) => { const membership = session.membershipId ? membershipById.get(session.membershipId) : null; const valid = membershipIsValid(session.membershipId); const remaining = Math.max(session.totalSessions - session.usedSessions, 0); const sessionUsages = usages.filter((usage) => usage.sessionId === session.id); return <div key={session.id} className="rounded-lg bg-white p-3 text-sm"><div className="flex items-center justify-between gap-3"><div><p>{t("ptRemaining", { remaining, total: session.totalSessions })}</p>{membership && <p className="mt-1 text-xs text-slate-500">{t("membershipValidity")}: {formatMembership(membership)}</p>}{!valid && <p className="mt-1 text-xs text-amber-700">{t("ptMembershipExpired")}</p>}</div><Button type="button" size="sm" variant="outline" disabled={busy || !canWrite || !valid || remaining <= 0} onClick={() => void post({ kind: "pt", action: "consume", id: session.id, idempotencyKey: operationKey(`gym-pt-consume-${session.id}`) })}>{t("consumePt")}</Button></div>{sessionUsages.length > 0 && <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{sessionUsages.map((usage) => <p key={usage.id}>{dateFormatter.format(new Date(usage.consumedAt))}{usage.appointmentId ? ` · ${usage.appointmentId}` : ""}</p>)}</div>}</div>; })}</div>
      </form>
      <form className="rounded-xl bg-slate-50 p-4" onSubmit={(event) => { event.preventDefault(); void post({ kind: "inbody", weightKg: weightKg ? Number(weightKg) : null, bodyFatPercent: bodyFat ? Number(bodyFat) : null, muscleKg: muscleKg ? Number(muscleKg) : null, bmi: bmi ? Number(bmi) : null, idempotencyKey: operationKey("gym-inbody") }); }}>
        <h4 className="font-semibold">{t("inbody")}</h4><div className="grid gap-2 sm:grid-cols-2"><InputField label={t("weightKg")} type="number" step="0.01" value={weightKg} onChange={setWeightKg} /><InputField label={t("bodyFatPercent")} type="number" step="0.01" value={bodyFat} onChange={setBodyFat} /><InputField label={t("muscleKg")} type="number" step="0.01" value={muscleKg} onChange={setMuscleKg} /><InputField label={t("bmi")} type="number" step="0.01" value={bmi} onChange={setBmi} /></div><Button className="mt-3" type="submit" disabled={busy || !canWrite}>{t("saveInbody")}</Button>
        <div className="mt-4 space-y-1 text-xs text-slate-600">{measurements.slice(0, 10).map((item) => <p key={item.id}>{dateFormatter.format(new Date(item.recordedAt))} · {item.weightKg === null ? "—" : (item.weightKg / 100).toFixed(2)} {t("unitKg")} · {item.bodyFatBps === null ? "—" : (item.bodyFatBps / 100).toFixed(1)}{t("unitPercent")} · {item.muscleKg === null ? "—" : (item.muscleKg / 100).toFixed(2)} {t("unitKg")} · BMI {item.bmiBps === null ? "—" : (item.bmiBps / 100).toFixed(2)}</p>)}</div>
      </form>
    </div>
  </section>;
}
