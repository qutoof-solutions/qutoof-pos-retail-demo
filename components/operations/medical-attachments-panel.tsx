"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, FileImage, FileText, Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate, Notice } from "@/components/operations/shared";
import { useLocale, useTranslations } from "next-intl";

const maxFileBytes = 10 * 1024 * 1024;
const acceptedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

type Attachment = { id: string; recordType: string; title: string; body: string | null; metadataJson: string | null; createdAt: string | Date; appointmentId: string | null };
type Visit = { id: string; serviceName: string; startsAt: string; providerName: string | null };
type AttachmentMetadata = { fileName: string; contentType: string; size: number | null };

function readMetadata(raw: string | null, title: string): AttachmentMetadata {
  try {
    const value = JSON.parse(raw ?? "{}") as { fileName?: unknown; contentType?: unknown; size?: unknown };
    return {
      fileName: typeof value.fileName === "string" ? value.fileName : title,
      contentType: typeof value.contentType === "string" ? value.contentType : "application/octet-stream",
      size: typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? value.size : null,
    };
  } catch {
    return { fileName: title, contentType: "application/octet-stream", size: null };
  }
}

function formatBytes(size: number | null, t: (key: string) => string): string {
  if (size === null) return t("attachmentSizeUnavailable");
  if (size < 1024) return `${size} ${t("bytes")}`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} ${t("kilobytes")}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${t("megabytes")}`;
}

export function MedicalAttachmentsPanel({
  customerId,
  records,
  visits,
  canUpload,
  canCreateCustomer,
  appointmentId,
  onAppointmentIdChange,
  onUploaded,
}: {
  customerId: string;
  records: Attachment[];
  visits: Visit[];
  canUpload: boolean;
  canCreateCustomer: boolean;
  appointmentId: string;
  onAppointmentIdChange: (value: string) => void;
  onUploaded: () => Promise<void>;
}) {
  const t = useTranslations("medical");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const attachments = records.filter((record) => record.recordType === "attachment").slice().reverse();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    setError("");
    setSuccess("");
    if (!(file instanceof File) || file.size < 1 || file.size > maxFileBytes || !acceptedMimeTypes.has(file.type)) {
      setError(t("attachmentValidation"));
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/ops/customers/${customerId}/files`, { method: "POST", body: form });
      formElement.reset();
      await onUploaded();
      setSuccess(t("attachmentUploaded"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("attachmentUploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-bold text-navy"><Paperclip size={18} className="text-teal" /> {t("medicalAttachments")}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{t("attachmentsDescription")}</p></div>
      <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal">PDF · JPG · PNG</span>
    </div>
    {error && <div className="mb-3"><Notice>{error}</Notice></div>}{success && <div className="mb-3"><Notice kind="success">{success}</Notice></div>}
    {canUpload && <form onSubmit={submit} className="mb-5 grid gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("documentName")}</span><input name="title" required minLength={2} maxLength={160} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" placeholder={t("documentNameExample")} /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("linkEncounterOptional")}</span><select name="appointmentId" value={appointmentId} onChange={(event) => onAppointmentIdChange(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm"><option value="">{t("patientFileOnly")}</option>{visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.serviceName} · {formatDate(visit.startsAt, true, locale)}</option>)}</select></label></div>
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("attachmentNotesOptional")}</span><textarea name="notes" rows={2} maxLength={2000} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder={t("attachmentNotesPlaceholder")} /></label>
      <div className="flex flex-wrap items-center gap-3"><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs" /><Button size="sm" disabled={busy} type="submit"><Upload size={15} />{busy ? t("uploading") : t("secureUpload")}</Button></div>
    </form>}
    {!canUpload && !canCreateCustomer && <p className="mb-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{t("nurseUploadNotice")}</p>}
    {attachments.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">{t("noMedicalAttachments")}</p> : <div className="space-y-4">{attachments.map((record) => {
      const metadata = readMetadata(record.metadataJson, record.title);
      const url = `/api/ops/customers/${customerId}/files/${record.id}`;
      const linkedVisit = visits.find((visit) => visit.id === record.appointmentId);
      return <article key={record.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal">{metadata.contentType === "application/pdf" ? <FileText size={19} /> : <FileImage size={19} />}</span><div className="min-w-0"><h4 className="break-words font-semibold text-navy">{record.title}</h4><p className="mt-1 break-all text-xs text-slate-600">{metadata.fileName}</p><p className="mt-1 text-xs text-slate-500">{formatDate(record.createdAt, true, locale)} · {formatBytes(metadata.size, t)}{linkedVisit ? ` · ${t("visitReportPrefix")} ${linkedVisit.serviceName} (${formatDate(linkedVisit.startsAt, true, locale)})` : ` · ${t("patientFileOnly")}`}</p></div></div><a href={`${url}?download=1`} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-teal hover:bg-teal/5" download><Download size={15} />{t("download")}</a></header>
        {record.body && <p className="border-t border-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{record.body}</p>}
        {metadata.contentType === "application/pdf" && <iframe title={`${t("preview")} ${record.title}`} src={url} className="h-[min(70vh,680px)] w-full border-t border-slate-100 bg-slate-50" loading="lazy" />}
        {(metadata.contentType === "image/jpeg" || metadata.contentType === "image/png") && <div className="border-t border-slate-100 bg-slate-50 p-3"><Image src={url} alt={`${t("preview")} ${record.title}`} width={1280} height={800} unoptimized className="mx-auto max-h-[640px] w-auto max-w-full object-contain" /></div>}
      </article>;
    })}</div>}
  </section>;
}
