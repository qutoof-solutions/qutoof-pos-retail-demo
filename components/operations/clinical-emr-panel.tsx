"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, formatMoney, Notice, SelectField } from "@/components/operations/shared";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FilePlus2, Printer, Save } from "lucide-react";
import { APPOINTMENT_STATUSES, StatusBadge } from "@/components/operations/status";
import { nextPatientFlowStatus } from "@/lib/operations/patient-flow";
import { MedicalRequestsPanel } from "@/components/operations/medical-requests-panel";

type Visit = { id: string; branchId: string | null; startsAt: string; serviceName: string; status: string };
type Problem = { name: string; status: "active" | "resolved" | "historical"; notes?: string };
type Prescription = { id: string; status: "active" | "cancelled"; medicineName: string; dose: string; doseUnit: string; frequency: string; duration: string; durationUnit: string; route: string; warnings: string; patientInstructions: string; inventoryItemId: string | null; warehouseId: string | null; dispenseQuantity: number | null; dispenseQuantityScale: number | null; dispensedAt: string | null; dispenseInvoiceNumber: string | null; createdAt: string };
type Encounter = { id: string; appointmentId: string | null; practitionerName: string | null; vitalsJson: string; allergiesText: string; problemsJson: string; assessment: string; plan: string; followUp: string | null; createdAt: string; prescriptions: Prescription[] };
type Ticket = { token: string; appointmentId: string; startsAt: string; endsAt: string; expiresAt: string };
type PharmacyProduct = { itemId: string; name: string; unitCode: string; quantityScale: number; sellingPriceMinor: number; warehouseId: string; warehouseName: string; quantityOnHand: number };
type PrescriptionTemplate = { id: string; name: string; itemsJson: string };

function safeJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }

export function ClinicalEmrPanel({ customerId, customerBranchId, visits, canWrite, patientFlow = false, onVisitStatusChanged }: { customerId: string; customerBranchId?: string | null; visits: Visit[]; canWrite: boolean; patientFlow?: boolean; onVisitStatusChanged?: () => Promise<void> }) {
  const t = useTranslations("medical");
  const locale = useLocale();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [allergies, setAllergies] = useState("");
  const [vitals, setVitals] = useState(t("vitalsTemplate"));
  const [problems, setProblems] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [prescriptionEncounterId, setPrescriptionEncounterId] = useState("");
  const [medicineName, setMedicineName] = useState("");
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [durationUnit, setDurationUnit] = useState(t("day"));
  const [route, setRoute] = useState("");
  const [warnings, setWarnings] = useState("");
  const [patientInstructions, setPatientInstructions] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [pharmacyProducts, setPharmacyProducts] = useState<PharmacyProduct[]>([]);
  const [pharmacyLoading, setPharmacyLoading] = useState(false);
  const [templates, setTemplates] = useState<PrescriptionTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [dispenseQuantity, setDispenseQuantity] = useState("1");
  const [dispenseConfirmationId, setDispenseConfirmationId] = useState("");
  const dispenseRequestKeys = useRef(new Map<string, string>());

  const selectedEncounter = encounters.find((encounter) => encounter.id === prescriptionEncounterId) ?? null;
  const selectedEncounterVisit = selectedEncounter?.appointmentId ? visits.find((visit) => visit.id === selectedEncounter.appointmentId) : undefined;
  const selectedBranchId = selectedEncounterVisit?.branchId ?? customerBranchId ?? "";

  async function refresh() {
    setLoading(true);
    try {
      const result = await apiRequest<{ encounters: Encounter[] }>(`/api/ops/customers/${customerId}/clinical`);
      setEncounters(result.encounters);
      const templateResult = await apiRequest<{ templates: PrescriptionTemplate[] }>("/api/ops/medical?type=templates").catch(() => ({ templates: [] }));
      setTemplates(templateResult.templates);
      setPrescriptionEncounterId((current) => result.encounters.some((encounter) => encounter.id === current) ? current : result.encounters.at(-1)?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("clinicalLoadFailed")); }
    finally { setLoading(false); }
  }
  // Refresh follows the selected customer; the callback intentionally uses current form state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [customerId]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    const first = template ? safeJson<Array<Record<string, string>>>(template.itemsJson, [])[0] : null;
    if (!first) return;
    setMedicineName(first.medicineName ?? ""); setDose(first.dose ?? ""); setDoseUnit(first.doseUnit ?? ""); setFrequency(first.frequency ?? ""); setDuration(first.duration ?? ""); setDurationUnit(first.durationUnit ?? t("day")); setRoute(first.route ?? ""); setWarnings(first.warnings ?? "");
  }

  useEffect(() => {
    let active = true;
    if (!selectedBranchId) { setPharmacyProducts([]); setPharmacyLoading(false); return () => { active = false; }; }
    setPharmacyLoading(true);
    void apiRequest<{ products: PharmacyProduct[] }>(`/api/ops/pos/catalog?branchId=${encodeURIComponent(selectedBranchId)}`)
      .then((result) => { if (active) setPharmacyProducts(result.products); })
      .catch(() => { if (active) setPharmacyProducts([]); })
      .finally(() => { if (active) setPharmacyLoading(false); });
    return () => { active = false; };
  }, [selectedBranchId]);

  function branchForEncounter(encounter: Encounter): string {
    return (encounter.appointmentId ? visits.find((visit) => visit.id === encounter.appointmentId)?.branchId : null) ?? customerBranchId ?? "";
  }

  async function addEncounter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    const vitalsObject = Object.fromEntries(vitals.split("\n").map((line) => line.split(":").map((part) => part.trim())).filter(([key]) => key));
    const problemRows: Problem[] = problems.split("\n").map((name) => name.trim()).filter(Boolean).map((name) => ({ name, status: "active" }));
    try {
      await apiRequest(`/api/ops/customers/${customerId}/clinical`, { method: "POST", body: JSON.stringify({ appointmentId: appointmentId || null, vitals: vitalsObject, allergies, problems: problemRows, assessment, plan, followUp: followUp || null }) });
      setAssessment(""); setPlan(""); setFollowUp(""); setProblems(""); setSuccess(t("encounterSaved")); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("encounterSaveFailed")); }
    finally { setBusy(false); }
  }

  async function addPrescription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!prescriptionEncounterId) return; setBusy(true); setError(""); setSuccess("");
    try {
      await apiRequest(`/api/ops/customers/${customerId}/clinical/${prescriptionEncounterId}/prescriptions`, { method: "POST", body: JSON.stringify({ medicineName, dose, doseUnit, frequency, duration, durationUnit, route, warnings, patientInstructions, inventoryItemId: inventoryItemId || null, warehouseId: warehouseId || null, dispenseQuantity: inventoryItemId ? Number(dispenseQuantity) : null }) });
      setMedicineName(""); setDose(""); setDoseUnit(""); setFrequency(""); setDuration(""); setRoute(""); setWarnings(""); setPatientInstructions(""); setInventoryItemId(""); setWarehouseId(""); setDispenseQuantity("1"); setSuccess(t("prescriptionSaved")); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("prescriptionSaveFailed")); }
    finally { setBusy(false); }
  }

  async function updateVisitStatus(visit: Visit, status: "in_progress" | "completed") {
    setBusy(true); setError(""); setSuccess("");
    try {
      await apiRequest(`/api/ops/appointments/${visit.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setSuccess(status === "in_progress" ? t("patientMovedToExam") : t("visitCompleted"));
      await onVisitStatusChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("patientStatusUpdateFailed")); }
    finally { setBusy(false); }
  }

  async function dispenseEncounter(encounter: Encounter) {
    const selected = encounter.prescriptions.filter((prescription) => prescription.status === "active" && !prescription.dispensedAt);
    if (!selected.length) { setError(t("noUndispensedPrescriptions")); return; }
    if (selected.some((prescription) => !prescription.inventoryItemId || !prescription.warehouseId || !prescription.dispenseQuantity)) { setError(t("linkPrescriptionBeforeDispense")); return; }
    const branchId = branchForEncounter(encounter);
    if (!branchId) { setError(t("encounterBranchRequired")); return; }
    const prescriptionIds = selected.map((prescription) => prescription.id).sort();
    const keySeed = `${customerId}:${branchId}:${encounter.appointmentId ?? "no-appointment"}:${prescriptionIds.join(",")}`;
    let idempotencyKey = dispenseRequestKeys.current.get(keySeed);
    if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); dispenseRequestKeys.current.set(keySeed, idempotencyKey); }
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await apiRequest<{ invoice: { invoiceNumber: string } }>("/api/ops/invoices", { method: "POST", body: JSON.stringify({ idempotencyKey, branchId, customerId, appointmentId: encounter.appointmentId, prescriptionIds, discount: 0, items: [], payments: [] }) });
      dispenseRequestKeys.current.delete(keySeed);
      setDispenseConfirmationId("");
      setSuccess(`${t("prescriptionDispensed")} ${result.invoice.invoiceNumber}؛ ${t("invoiceUnpaidNotice")}`);
      await refresh();
      await onVisitStatusChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("dispenseFailed")); }
    finally { setBusy(false); }
  }

  async function issueTicket(visit: Visit) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await apiRequest<{ ticket: Ticket }>(`/api/ops/appointments/${visit.id}/ticket`, { method: "POST", body: "{}" });
      setTicket(response.ticket); setSuccess(t("ticketIssued"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("ticketIssueFailed")); }
    finally { setBusy(false); }
  }

  const latestEncounter = encounters.at(-1);
  const latestProblems = latestEncounter ? safeJson<Problem[]>(latestEncounter.problemsJson, []) : [];
  return <section className="print-area rounded-2xl border border-teal/20 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <style jsx global>{`@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; inset: 0; border: 0; box-shadow: none; } .no-print { display: none !important; } }`}</style>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold text-teal">EMR V1</p><h3 className="mt-1 text-lg font-bold text-navy">{t("clinicalRecord")}</h3><p className="mt-1 text-xs text-slate-500">{t("noAutomatedDiagnosis")}</p></div>
      <Button className="no-print" size="sm" variant="outline" onClick={() => window.print()}><Printer size={15} /> {t("printExportPdf")}</Button>
    </div>
    {error && <div className="mt-3 no-print"><Notice>{error}</Notice></div>}
    {success && <div className="mt-3 no-print"><Notice kind="success">{success}</Notice></div>}
    <div className="mt-4"><MedicalRequestsPanel customerId={customerId} encounterId={latestEncounter?.id} disabled={!canWrite} /></div>
    {latestEncounter && (latestEncounter.allergiesText || latestProblems.length > 0) && <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"><strong>{t("importantClinicalAlerts")}</strong>{latestEncounter.allergiesText && <p className="mt-1">{t("allergiesLabel")}: {latestEncounter.allergiesText}</p>}{latestProblems.length > 0 && <p className="mt-1">{t("problemsLabel")}: {latestProblems.map((problem) => problem.name).join("، ")}</p>}</div>}
    {patientFlow && canWrite && <section className="no-print mt-5 rounded-xl border border-teal/20 bg-teal/5 p-4"><h4 className="font-bold text-navy">{t("patientFlow")}</h4><p className="mt-1 text-xs text-slate-600">{t("patientFlowHelp")}</p>{visits.filter((visit) => ["confirmed", "waiting", "in_progress"].includes(visit.status)).length ? <div className="mt-3 space-y-2">{visits.filter((visit) => ["confirmed", "waiting", "in_progress"].includes(visit.status)).map((visit) => <div key={visit.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-3"><div className="min-w-44 flex-1"><strong className="text-sm text-navy">{visit.serviceName}</strong><p className="mt-1 text-xs text-slate-500">{new Date(visit.startsAt).toLocaleString("ar-EG-u-nu-latn")}</p></div><StatusBadge status={visit.status as keyof typeof APPOINTMENT_STATUSES} patientFlow />{nextPatientFlowStatus(visit.status) === "in_progress" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateVisitStatus(visit, "in_progress")}>{t("enterExamRoom")}</Button>}{nextPatientFlowStatus(visit.status) === "completed" && <Button size="sm" disabled={busy} onClick={() => void updateVisitStatus(visit, "completed")}><CheckCircle2 size={15} /> {t("completeVisit")}</Button>}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">{t("noCurrentVisits")}</p>}</section>}
    {loading ? <p className="mt-5 text-sm text-slate-500">{t("loadingClinicalRecord")}</p> : <div className="mt-5 space-y-4">
      {encounters.length ? [...encounters].reverse().map((encounter) => {
        const parsedVitals = safeJson<Record<string, string>>(encounter.vitalsJson, {});
        const parsedProblems = safeJson<Problem[]>(encounter.problemsJson, []);
        const undisposedPrescriptions = encounter.prescriptions.filter((prescription) => prescription.status === "active" && !prescription.dispensedAt);
        const canDispense = undisposedPrescriptions.length > 0 && undisposedPrescriptions.every((prescription) => Boolean(prescription.inventoryItemId && prescription.warehouseId && prescription.dispenseQuantity));
        return <article key={encounter.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-navy">{t("clinicalEncounter")} · {encounter.practitionerName ?? t("practitioner")}</strong><p className="mt-1 text-xs text-slate-500">{new Date(encounter.createdAt).toLocaleString("ar-EG-u-nu-latn")}</p></div>{encounter.prescriptions.length > 0 && <Button className="no-print" size="sm" variant="outline" onClick={() => setPrescriptionEncounterId(encounter.id)}><Printer size={14} /> {t("preparePrescription")}</Button>}</div>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><b>{t("allergies")}:</b> {encounter.allergiesText || t("noRecordedData")}</div><div><b>{t("vitalSigns")}:</b><pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{Object.entries(parsedVitals).map(([key, value]) => `${key}: ${value}`).join("\n") || "—"}</pre></div><div><b>{t("problems")}:</b> {parsedProblems.map((problem) => problem.name).join("، ") || "—"}</div><div><b>{t("followUp")}:</b> {encounter.followUp || "—"}</div></div>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><p><b>{t("assessment")}:</b><br />{encounter.assessment}</p><p><b>{t("plan")}:</b><br />{encounter.plan}</p></div>
          {encounter.prescriptions.length > 0 && <div className="mt-3 rounded-lg bg-teal/5 p-3 text-sm"><b>{t("structuredPrescriptions")}</b><div className="mt-2 space-y-2">{encounter.prescriptions.map((item) => <div key={item.id} className="rounded-lg bg-white p-3"><p>{item.medicineName} · {item.dose} {item.doseUnit} · {item.frequency} · {item.duration} {item.durationUnit} · {item.route}{item.warnings ? ` · ${t("warningLabel")}: ${item.warnings}` : ""}</p>{item.patientInstructions && <p dir="auto" className="mt-2 whitespace-pre-wrap border-t border-slate-200 pt-2 text-xs leading-5 text-slate-700"><strong>{t("patientInstructions")}:</strong><br />{item.patientInstructions}</p>}{item.inventoryItemId ? <p className="mt-1 text-xs text-slate-600">{t("inventoryLinked")} · {t("quantityLabel")} {item.dispenseQuantityScale === null || item.dispenseQuantity === null ? "—" : item.dispenseQuantity / (10 ** item.dispenseQuantityScale)}{item.dispensedAt ? ` · ${t("dispensedInInvoice")} ${item.dispenseInvoiceNumber ?? ""}` : ` · ${t("notDispensed")}`}</p> : <p className="mt-1 text-xs text-amber-700">{t("notLinkedToDispensableItem")}</p>}</div>)}</div>{canWrite && canDispense && <div className="no-print mt-3">{dispenseConfirmationId !== encounter.id ? <Button size="sm" variant="outline" disabled={busy || !branchForEncounter(encounter)} onClick={() => { setDispenseConfirmationId(encounter.id); setError(""); }}><CheckCircle2 size={15} /> {t("dispenseMedications")}</Button> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs leading-5 text-amber-900">{t("dispenseConfirmation")}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void dispenseEncounter(encounter)}>{t("confirmDispense")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setDispenseConfirmationId("")}>{t("cancel")}</Button></div></div>}</div>}{canWrite && undisposedPrescriptions.length > 0 && !canDispense && <p className="no-print mt-3 text-xs text-amber-700">{t("linkPrescriptionInventoryHint")}</p>}</div>}
        </article>;
      }) : <p className="text-sm text-slate-500">{t("noStructuredEncounters")}</p>}
      {canWrite && <div className="no-print space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h4 className="font-bold text-navy">{t("digitalTickets")}</h4><p className="mt-1 text-xs text-slate-500">{t("digitalTicketsHelp")}</p><div className="mt-3 flex flex-wrap gap-2">{visits.filter((visit) => ["pending", "confirmed", "waiting", "in_progress"].includes(visit.status)).map((visit) => <Button key={visit.id} size="sm" variant="outline" disabled={busy} onClick={() => void issueTicket(visit)}>{t("issueTicket")} · {visit.serviceName} · {new Date(visit.startsAt).toLocaleDateString("ar-EG-u-nu-latn")}</Button>)}</div>{ticket && <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl bg-white p-4"><QRCodeSVG value={ticket.token} size={132} includeMargin /><div className="text-sm"><b>{t("ticketCode")}</b><p className="mt-1 max-w-md break-all font-mono text-xs" dir="ltr">{ticket.token}</p><p className="mt-2 text-xs text-slate-500">{t("validUntil")} {new Date(ticket.expiresAt).toLocaleString("ar-EG-u-nu-latn")}</p><Button className="mt-3" size="sm" onClick={() => window.print()}><Printer size={14} /> {t("printTicket")}</Button></div></div>}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={addEncounter} className="rounded-xl bg-slate-50 p-4"><h4 className="font-bold text-navy"><FilePlus2 className="ml-1 inline" size={16} /> {t("addStructuredEncounter")}</h4><SelectField label={t("linkedAppointment")} value={appointmentId} onChange={setAppointmentId} options={[{ value: "", label: t("chooseAppointment") }, ...visits.map((visit) => ({ value: visit.id, label: `${visit.serviceName} · ${new Date(visit.startsAt).toLocaleDateString("ar-EG-u-nu-latn")}` }))]} /><textarea value={vitals} onChange={(event) => setVitals(event.target.value)} rows={3} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("vitalSigns")} /><textarea value={allergies} onChange={(event) => setAllergies(event.target.value)} rows={2} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("allergies")} /><textarea value={problems} onChange={(event) => setProblems(event.target.value)} rows={2} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("problemPerLine")} required /><textarea value={assessment} onChange={(event) => setAssessment(event.target.value)} rows={3} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("assessment")} required /><textarea value={plan} onChange={(event) => setPlan(event.target.value)} rows={3} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("plan")} required /><textarea value={followUp} onChange={(event) => setFollowUp(event.target.value)} rows={2} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder={t("followUp")} /><Button className="mt-3" disabled={busy} type="submit"><Save size={15} />{t("saveEncounter")}</Button></form>
          <form onSubmit={addPrescription} className="rounded-xl bg-slate-50 p-4"><h4 className="font-bold text-navy">{t("structuredPrescriptionEditor")}</h4>{templates.length > 0 && <SelectField label={t("applyPrescriptionTemplate")} value={templateId} onChange={applyTemplate} options={[{ value: "", label: t("choosePrescriptionTemplate") }, ...templates.map((template) => ({ value: template.id, label: template.name }))]} />}<SelectField label={t("encounter")} value={prescriptionEncounterId} onChange={setPrescriptionEncounterId} options={encounters.map((encounter) => ({ value: encounter.id, label: `${new Date(encounter.createdAt).toLocaleDateString("ar-EG-u-nu-latn")} · ${encounter.practitionerName ?? t("practitioner")}` }))} /><div className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs font-semibold text-navy">{t("inventoryLinkHeading")}</p><p className="mt-1 text-xs text-slate-500">{t("inventoryLinkHelp")}</p>{pharmacyLoading ? <p className="mt-2 text-xs text-slate-500">{t("loadingBranchItems")}</p> : !selectedBranchId ? <p className="mt-2 text-xs text-amber-700">{t("branchRequiredForInventory")}</p> : <select aria-label={t("inventoryOptionAria")} value={inventoryItemId && warehouseId ? `${inventoryItemId}::${warehouseId}` : ""} onChange={(event) => { const [nextItemId, nextWarehouseId] = event.target.value.split("::"); setInventoryItemId(nextItemId ?? ""); setWarehouseId(nextWarehouseId ?? ""); }} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">{t("noInventoryLink")}</option>{pharmacyProducts.map((product) => <option key={`${product.itemId}:${product.warehouseId}`} value={`${product.itemId}::${product.warehouseId}`}>{product.name} · {product.warehouseName} · {t("available")} {product.quantityOnHand / (10 ** product.quantityScale)} {product.unitCode} · {formatMoney(product.sellingPriceMinor, locale)}</option>)}</select>}{inventoryItemId && <label className="mt-3 block text-xs font-medium text-slate-600">{t("dispenseQuantity")}<input type="number" min="0.0001" step="any" max="1000000" required value={dispenseQuantity} onChange={(event) => setDispenseQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><input value={medicineName} onChange={(event) => setMedicineName(event.target.value)} placeholder={t("medicineOrDrug")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={dose} onChange={(event) => setDose(event.target.value)} placeholder={t("dose")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={doseUnit} onChange={(event) => setDoseUnit(event.target.value)} placeholder={t("unit")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={frequency} onChange={(event) => setFrequency(event.target.value)} placeholder={t("frequency")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder={t("duration")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={durationUnit} onChange={(event) => setDurationUnit(event.target.value)} placeholder={t("durationUnit")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /><input value={route} onChange={(event) => setRoute(event.target.value)} placeholder={t("administrationRoute")} required className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-2" /></div><textarea dir="auto" value={warnings} onChange={(event) => setWarnings(event.target.value)} rows={3} className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder={t("warnings")} /><textarea dir="auto" value={patientInstructions} onChange={(event) => setPatientInstructions(event.target.value)} rows={3} maxLength={4000} className="mt-3 w-full rounded-xl border border-teal/30 bg-teal/5 p-3 text-sm" placeholder={t("patientInstructionsPlaceholder")} /><p className="mt-2 text-xs text-amber-700">{t("noInteractionReview")}</p><Button className="mt-3" disabled={busy || !prescriptionEncounterId} type="submit"><Save size={15} />{t("savePrescription")}</Button></form>
        </div>
      </div>}
    </div>}
  </section>;
}
