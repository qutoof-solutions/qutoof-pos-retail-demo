"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, InputField, ModuleTitle, Notice } from "@/components/operations/shared";
import { useLocale, useTranslations } from "next-intl";

type Contract = { id: string; name: string; contractType: string; discountBps: number; copayBps: number };
type Claim = { claim: { id: string; claimMonth: string; grossMinor: number; patientDueMinor: number; claimMinor: number; status: string; version: number; rejectionReason: string | null; memberNumber: string | null }; contractName: string; patientName: string; invoiceNumber: string };
type ClaimEvent = { id: string; claimId: string; version: number; type: string; fromStatus: string | null; toStatus: string | null; actorId: string | null; actorName: string | null; idempotencyKey: string; metadata: Record<string, unknown>; createdAt: string };
type Template = { id: string; name: string; itemsJson: string };
const money = (n: number) => `${(n / 100).toFixed(2)} EGP`;

export function MedicalContractsModule() {
  const locale = useLocale();
  const t = useTranslations("medical");
  const claimT = useTranslations("register");
  const en = locale === "en";
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimEvents, setClaimEvents] = useState<Record<string, ClaimEvent[]>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("0");
  const [copay, setCopay] = useState("100");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const [c, k, templateResult] = await Promise.all([
      apiRequest<{ contracts: Contract[] }>("/api/ops/medical?type=contracts"),
      apiRequest<{ claims: Claim[] }>("/api/ops/medical?type=claims"),
      apiRequest<{ templates: Template[] }>("/api/ops/medical?type=templates"),
    ]);
    setContracts(c.contracts);
    setClaims(k.claims);
    const eventResults = await Promise.all(k.claims.map(async (row) => [row.claim.id, (await apiRequest<{ events: ClaimEvent[] }>(`/api/ops/medical?type=claim_events&claimId=${encodeURIComponent(row.claim.id)}&page=1&pageSize=25`)).events] as const));
    setClaimEvents(Object.fromEntries(eventResults));
    setTemplates(templateResult.templates);
  }

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : t("medicalLoadFailed"))); }, [t]);

  async function updateClaim(claim: Claim["claim"], nextStatus: "submitted" | "approved" | "rejected" | "paid") {
    setBusy(true); setError(""); setSuccess("");
    try {
      const rejectionReason = nextStatus === "rejected" ? window.prompt(claimT("rejectionReason")) : null;
      if (nextStatus === "rejected" && !rejectionReason?.trim()) return;
      await apiRequest("/api/ops/medical", { method: "PATCH", body: JSON.stringify({ action: "claim_status", claimId: claim.id, nextStatus, expectedVersion: claim.version, idempotencyKey: crypto.randomUUID(), rejectionReason }) });
      setSuccess(claimT("insuranceClaimTransitioned")); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : claimT("insuranceClaimTransitionFailed")); }
    finally { setBusy(false); }
  }

  async function addContract(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/ops/medical", { method: "POST", body: JSON.stringify({ action: "contract", name, contractType: "insurance", discountPercent: Number(discount), copayPercent: Number(copay), memberNumberLabel: claimT("memberNumberLabel") }) });
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("medicalSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addTemplate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/ops/medical", { method: "POST", body: JSON.stringify({ action: "template", name: templateName, items: [{ medicineName: "", dose: "", doseUnit: "", frequency: "", duration: "", durationUnit: "", route: "", warnings: "" }] }) });
      setTemplateName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("medicalSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const claimStatusLabel = (status: string) => {
    const statuses: Record<string, string> = { open: claimT("claimStates.open"), submitted: claimT("claimStates.submitted"), approved: claimT("claimStates.approved"), rejected: claimT("claimStates.rejected"), paid: claimT("claimStates.paid") };
    return statuses[status] ?? claimT("insuranceClaimStatus");
  };

  const eventStatusLabel = (event: ClaimEvent) => event.type === "created" ? claimStatusLabel(event.toStatus ?? "open") : `${claimStatusLabel(event.fromStatus ?? "")} → ${claimStatusLabel(event.toStatus ?? "")}`;
  const eventDateLabel = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return <section dir={en ? "ltr" : "rtl"}>
    <ModuleTitle eyebrow={t("medicalOperations")} title={t("insuranceClinicalTools")} description={t("contractsClaimsTemplatesDescription")} />
    {error && <Notice>{error}</Notice>}
    {success && <p className="mt-2 text-sm text-teal">{success}</p>}
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-navy">{t("insuranceContracts")}</h2>
        <form onSubmit={addContract} className="mt-4 grid gap-3 sm:grid-cols-3"><InputField label={t("name")} value={name} onChange={setName} required /><InputField label={t("discountPercent")} type="number" min="0" max="100" value={discount} onChange={setDiscount} /><InputField label={t("copayPercent")} type="number" min="0" max="100" value={copay} onChange={setCopay} /><Button disabled={busy} type="submit" className="sm:col-span-3">{t("addContract")}</Button></form>
        <div className="mt-4 space-y-2">{contracts.map((contract) => <div key={contract.id} className="rounded-xl bg-slate-50 p-3 text-sm"><b>{contract.name}</b><span className="mx-2 text-slate-500">{contract.discountBps / 100}% {t("discountShort")} · {contract.copayBps / 100}% {t("copayShort")}</span></div>)}</div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold text-navy">{t("prescriptionTemplates")}</h2><form onSubmit={addTemplate} className="mt-4 flex gap-2"><InputField label={t("templateName")} value={templateName} onChange={setTemplateName} required /><Button disabled={busy} type="submit">{t("save")}</Button></form><div className="mt-4 space-y-2">{templates.map((template) => <div key={template.id} className="rounded-xl bg-slate-50 p-3 text-sm">{template.name}</div>)}</div></section>
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold text-navy">{t("monthlyClaims")}</h2>{claims.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-right">{t("patient")}</th><th className="p-3 text-right">{t("contract")}</th><th className="p-3 text-right">{t("month")}</th><th className="p-3 text-right">{t("gross")}</th><th className="p-3 text-right">{t("claim")}</th><th className="p-3 text-right">{t("status")}</th></tr></thead><tbody>{claims.map((claim) => <tr key={claim.claim.id} className="border-t align-top"><td className="p-3">{claim.patientName}</td><td className="p-3">{claim.contractName}</td><td className="p-3" dir="ltr">{claim.claim.claimMonth}</td><td className="p-3">{money(claim.claim.grossMinor)}</td><td className="p-3 font-bold text-teal">{money(claim.claim.claimMinor)}</td><td className="p-3"><span>{claimStatusLabel(claim.claim.status)}</span><p className="mt-1 text-xs text-slate-500" dir="ltr">{claim.invoiceNumber}{claim.claim.memberNumber ? ` · ${claim.claim.memberNumber}` : ""}</p>{claim.claim.rejectionReason && <p className="mt-1 text-xs text-rose-700">{claimT("claimRejectionReason")}: {claim.claim.rejectionReason}</p>}<div className="mt-2 flex flex-wrap gap-1">{claim.claim.status === "open" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateClaim(claim.claim, "submitted")}>{claimT("submitClaim")}</Button>}{claim.claim.status === "submitted" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateClaim(claim.claim, "approved")}>{claimT("approveClaim")}</Button>}{claim.claim.status === "approved" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateClaim(claim.claim, "paid")}>{claimT("markClaimPaid")}</Button>}{["open", "submitted", "approved"].includes(claim.claim.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateClaim(claim.claim, "rejected")}>{claimT("rejectClaim")}</Button>}</div><div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-600">{t("status")}</p>{claimEvents[claim.claim.id]?.length ? <ol className="mt-2 space-y-2 border-s-2 border-slate-200 ps-3">{claimEvents[claim.claim.id].map((event) => <li key={event.id} className="text-xs"><div className="font-medium text-slate-700">{eventStatusLabel(event)}</div><div className="text-slate-500">v{event.version} · {event.actorName ?? "—"} · {eventDateLabel(event.createdAt)}</div></li>)}</ol> : <p className="mt-1 text-xs text-slate-400">—</p>}</div></td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">{t("noClaimsYet")}</p>}</section>
  </section>;
}
