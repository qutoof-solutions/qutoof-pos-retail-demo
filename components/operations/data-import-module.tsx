"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/components/operations/shared";
import { createCsvTemplate, createXlsxTemplate, type DataLocale, type ImportDataset } from "@/lib/operations/data-portability";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type Warehouse = { id: string; code: string; name: string };
type Summary = { inserted: Record<ImportDataset, number>; skipped: Record<ImportDataset, number>; rows: Record<ImportDataset, number>; errors: Array<{ dataset: ImportDataset; row: number; message: string }>; warnings: Array<{ dataset: ImportDataset; row: number; message: string }> };
type Result = { summary: Summary; branchRequired?: boolean; warehouseRequired?: boolean; replayed?: boolean; importedAt?: string };
type Props = { vertical: string };

const DATASETS: Array<{ key: ImportDataset; ar: string; en: string }> = [
  { key: "products", ar: "الأصناف والمتغيرات", en: "Products and variants" },
  { key: "stock", ar: "أرصدة المخزون", en: "Stock balances" },
  { key: "customers", ar: "العملاء", en: "Customers" },
  { key: "patients", ar: "المرضى", en: "Patients" },
  { key: "suppliers", ar: "الموردون", en: "Suppliers" },
];
function arMessage(message: string): string {
  const rules: Array<[RegExp, string]> = [
    [/SKU is required/i, "رمز SKU مطلوب، ويُسمح بالحروف والأرقام والنقطة والشرطة والشرطة السفلية فقط."],
    [/SKU is repeated/i, "رمز SKU مكرر داخل الملف."], [/Product name must/i, "اسم الصنف يجب أن يتكون من حرفين على الأقل."],
    [/Barcode is repeated/i, "الباركود مكرر داخل الملف."], [/Barcode is already used/i, "الباركود مستخدم مسبقًا لصنف آخر في مساحة العمل."],
    [/Quantity scale must/i, "دقة الكمية يجب أن تكون عددًا صحيحًا من 0 إلى 4."], [/Quantity scale \(/i, "عدد المنازل العشرية للكمية أكبر من دقة الصنف."],
    [/must be a number from 0 to/i, "يجب إدخال رقم ضمن النطاق المسموح."], [/greater than zero/i, "يجب أن تكون الكمية أكبر من صفر."], [/zero or greater/i, "يجب أن تكون القيمة صفرًا أو أكبر."],
    [/Track expiry must/i, "أدخل نعم أو لا لتحديد تتبع الصلاحية."], [/Expiry tracking requires/i, "تتبع الصلاحية يتطلب تفعيل تتبع التشغيلات."],
    [/Opening stock requires/i, "رصيد البداية يحتاج إلى رمز مخزن متاح أو اختيار مخزن افتراضي."], [/Lot number is required/i, "رقم التشغيلة مطلوب للصنف الذي يتتبع التشغيلات."], [/Expiry date is required/i, "تاريخ الصلاحية مطلوب لهذا الصنف."],
    [/Expiry date must use/i, "استخدم صيغة التاريخ YYYY-MM-DD."], [/cannot be in the future/i, "لا يمكن أن يكون تاريخ الميلاد في المستقبل."], [/Expired lots cannot/i, "لا يمكن استيراد تشغيلة منتهية الصلاحية كرصد متاح."],
    [/SKU was not found/i, "لم يتم العثور على رمز الصنف في مساحة العمل أو ضمن ورقة الأصناف."], [/active accessible warehouse/i, "اختر مخزنًا نشطًا ومتاحًا أو أدخل رمزه/اسمه."],
    [/same item\/warehouse\/lot appears more than once/i, "الصنف/المخزن/التشغيلة نفسها مكررة في الملف."], [/expiry date for this existing lot/i, "تاريخ الصلاحية لا يطابق بيانات التشغيلة الموجودة."],
    [/Full name must/i, "الاسم الكامل يجب أن يتكون من حرفين على الأقل."], [/Phone must/i, "رقم الهاتف غير صالح؛ استخدم 6–32 رقمًا مع رموز الهاتف الشائعة."], [/Phone number is repeated/i, "رقم الهاتف مكرر أو غير صالح داخل الملف."],
    [/Email address is invalid/i, "عنوان البريد الإلكتروني غير صالح."], [/Gender must/i, "النوع يجب أن يكون ذكرًا أو أنثى أو غير محدد."], [/Supplier name must/i, "اسم المورد يجب أن يتكون من حرفين على الأقل."],
    [/Required column\(s\) missing/i, "هناك أعمدة مطلوبة غير موجودة في صف العناوين؛ استخدم القالب المناسب."], [/column .* is duplicated/i, "يوجد عنوان عمود مكرر في صف العناوين."], [/headers but no data rows/i, "القالب يحتوي على عناوين فقط ولا يحتوي على صفوف بيانات."],
    [/already exists; it will be skipped/i, "السجل موجود مسبقًا وسيتم تخطيه."], [/same tax number\/contact\/name already exists/i, "المورد موجود مسبقًا بنفس الرقم الضريبي أو وسيلة التواصل وسيتم تخطيه."],
    [/No active inventory warehouse/i, "لا يوجد مخزن نشط متاح؛ أنشئ مخزنًا أو اطلب من المدير إتاحته."], [/Unknown data sheet/i, "اسم ورقة غير مدعوم في ملف Excel."], [/duplicate .* sheets/i, "يحتوي ملف Excel على ورقتين بالاسم نفسه."], [/no supported data rows/i, "لم يتم العثور على صفوف بيانات مدعومة."],
  ];
  const match = rules.find(([pattern]) => pattern.test(message));
  return match?.[1] ?? "تعذر التحقق من هذه القيمة. راجع صف العناوين والقالب، وتأكد من صحة البيانات.";
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function templateLabel(locale: DataLocale, dataset: ImportDataset): string {
  const found = DATASETS.find((item) => item.key === dataset)!;
  return locale === "ar" ? found.ar : found.en;
}

export function DataImportModule({ vertical }: Props) {
  const { locale } = useDataLocale();
  const isArabic = locale === "ar";
  const t = useTranslations("operationsRemaining");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [dataset, setDataset] = useState<ImportDataset>("products");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [requestKey, setRequestKey] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<{ branches: Branch[] }>("/api/ops/context").then((value) => { if (active) { setBranches(value.branches); setBranchId((current) => current || value.branches[0]?.id || ""); } }).catch(() => undefined);
    void apiRequest<{ warehouses: Warehouse[] }>("/api/ops/inventory/warehouses").then((value) => { if (active) { setWarehouses(value.warehouses); setWarehouseId((current) => current || value.warehouses[0]?.id || ""); } }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const availableDatasets = DATASETS.filter((item) => item.key !== "patients" || vertical === "medical");
  const activeSummary = result?.summary;
  const totalErrors = activeSummary?.errors.length ?? 0;

  function resetForChange() { setResult(null); setSuccess(""); setError(""); setRequestKey(""); }
  async function run(mode: "preview" | "commit") {
    setError(""); setSuccess("");
    if (!file) { setError(t("noFile")); return; }
    if (mode === "commit" && (!result || result.summary.errors.length)) { setError(t("changed")); return; }
    if (mode === "commit" && !window.confirm(t("confirm"))) return;
    setBusy(mode);
    try {
      const form = new FormData(); form.set("file", file); form.set("mode", mode); form.set("dataset", dataset); form.set("branchId", branchId); form.set("warehouseId", warehouseId); form.set("locale", locale);
      const key = requestKey || crypto.randomUUID();
      if (mode === "commit") setRequestKey(key);
      const response = await fetch("/api/ops/data-import", { method: "POST", body: form, headers: mode === "commit" ? { "Idempotency-Key": key } : {}, cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Result & { error?: string };
      if (body.summary) setResult({ summary: body.summary, branchRequired: body.branchRequired, warehouseRequired: body.warehouseRequired, replayed: body.replayed, importedAt: body.importedAt });
      if (!response.ok) throw new Error(body.error ?? t("actionError"));
      if (mode === "preview") setSuccess(t("previewOk"));
      else { setSuccess(t(body.replayed ? "replayed" : "imported")); setResult(null); setFile(null); setRequestKey(""); }
    } catch (cause) { setError(cause instanceof Error ? (isArabic ? arMessage(cause.message) : cause.message) : t("actionError")); }
    finally { setBusy(null); }
  }
  function downloadWorkbook() {
    const bytes = createXlsxTemplate(locale);
    downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `qutoof-import-template-${locale}.xlsx`);
  }
  function downloadCsv(datasetKey: ImportDataset) {
    const csv = createCsvTemplate(datasetKey, locale);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `qutoof-${datasetKey}-template-${locale}.csv`);
  }
  const counts = activeSummary ? [
    ["products", "products"], ["stock", "stock"], ["customers", "customers"], ["patients", "patients"], ["suppliers", "suppliers"],
  ] as Array<[ImportDataset, string]> : [];

  return <section className="space-y-6" dir={isArabic ? "rtl" : "ltr"}>
    <header className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-teal">{t("dataPortability")}</p><h1 className="text-2xl font-bold text-navy dark:text-white">{t("title")}</h1><p className="max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">{t("description")}</p></header>

    <article className="rounded-2xl border border-teal/20 bg-gradient-to-br from-white to-teal/5 p-5 shadow-sm dark:border-teal/30 dark:from-slate-900 dark:to-teal/10 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-bold text-navy dark:text-white"><FileUp size={18} className="text-teal" />{t("uploadDataFile")}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 md:col-span-2"><span>{t("file")}</span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetForChange(); }} className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-teal/10 file:px-3 file:py-2 file:font-semibold file:text-teal dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        {file?.name.toLowerCase().endsWith(".csv") && <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><span>{t("type")}</span><select value={dataset} onChange={(event) => { setDataset(event.target.value as ImportDataset); resetForChange(); }} className="h-11 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white">{availableDatasets.map((item) => <option key={item.key} value={item.key}>{templateLabel(locale, item.key)}</option>)}</select></label>}
        {(dataset === "customers" || dataset === "patients" || file?.name.toLowerCase().endsWith(".xlsx")) && <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><span>{t("branch")}</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); resetForChange(); }} className="h-11 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">{t("choose")}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{localizedBranchName(branch, locale)}</option>)}</select></label>}
        {(dataset === "products" || dataset === "stock" || file?.name.toLowerCase().endsWith(".xlsx")) && <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><span>{t("warehouse")}</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); resetForChange(); }} className="h-11 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">{t("choose")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label>}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void run("preview")} disabled={busy !== null || !file} className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-bold text-white shadow-sm transition hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck size={17} />{busy === "preview" ? t("loading") : t("preview")}</button><button type="button" onClick={() => void run("commit")} disabled={busy !== null || !file || !result || totalErrors > 0} className="inline-flex h-11 items-center gap-2 rounded-xl border border-teal/30 bg-teal/5 px-4 text-sm font-bold text-teal transition hover:bg-teal/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-200"><CheckCircle2 size={17} />{busy === "commit" ? t("loading") : t("commit")}</button><span className="text-xs text-slate-500 dark:text-slate-400">{file?.name ?? t("emptySummary")}</span>{busy && <LoaderCircle size={18} className="animate-spin text-teal" />}</div>
    </article>

    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    {success && <div role="status" className="flex items-start gap-2 rounded-xl border border-teal/20 bg-teal/5 p-4 text-sm text-teal-900 dark:text-teal-100"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><span>{success}</span></div>}

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold text-navy dark:text-white"><FileSpreadsheet size={18} className="text-teal" />{t("templates")}</h2>
        <button type="button" onClick={downloadWorkbook} className="mb-4 inline-flex h-10 items-center gap-2 rounded-xl border border-teal/30 bg-teal/5 px-3 text-sm font-bold text-teal transition hover:bg-teal/10 dark:text-teal-200"><Download size={16} />{t("templateXlsx")}</button>
        <div className="grid gap-3 sm:grid-cols-2">{availableDatasets.map((item) => <div key={item.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"><span className="text-sm font-medium text-slate-700 dark:text-slate-200">{templateLabel(locale, item.key)}</span><button type="button" onClick={() => downloadCsv(item.key)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-teal hover:bg-teal/10">{t("templateCsv")}</button></div>)}</div>
        <h3 className="mb-2 mt-6 font-bold text-navy dark:text-white">{t("instructions")}</h3><ul className="list-disc space-y-2 ps-5 text-sm leading-6 text-slate-600 dark:text-slate-300"><li>{t("note1")}</li><li>{t("note2")}</li><li>{t("note3")}</li><li>{t("note4")}</li></ul>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold text-navy dark:text-white"><RotateCcw size={18} className="text-teal" />{t("previewSummary")}</h2>
        {!activeSummary && <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500 dark:bg-slate-950 dark:text-slate-400">{t("emptySummary")}</p>}
        {activeSummary && <><div className="space-y-2">{counts.map(([key]) => (activeSummary.rows[key] ?? 0) > 0 && <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><span className="font-semibold text-slate-800 dark:text-slate-100">{templateLabel(locale, key)}</span><span className="text-teal">{t("inserted")}: {activeSummary.inserted[key] ?? 0}</span><span className="text-amber-700 dark:text-amber-300">{t("skipped")}: {activeSummary.skipped[key] ?? 0}</span></div>)}</div>
          {totalErrors === 0 && <p className="mt-4 rounded-xl bg-teal/5 p-3 text-sm font-medium text-teal-900 dark:text-teal-100">{t("noErrors")}</p>}
          {totalErrors > 0 && <div className="mt-4"><h3 className="mb-2 font-bold text-rose-800 dark:text-rose-300">{t("validation")} ({totalErrors})</h3><ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/30">{activeSummary.errors.map((issue, index) => <li key={`${issue.dataset}-${issue.row}-${index}`} className="leading-6"><b>{templateLabel(locale, issue.dataset)} · {t("row")} {issue.row}:</b> {isArabic ? arMessage(issue.message) : issue.message}</li>)}</ul></div>}
          {activeSummary.warnings.length > 0 && <div className="mt-4"><h3 className="mb-2 font-bold text-amber-800 dark:text-amber-300">{t("warnings")} ({activeSummary.warnings.length})</h3><ul className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">{activeSummary.warnings.map((issue, index) => <li key={`${issue.dataset}-${issue.row}-${index}`} className="leading-6"><b>{templateLabel(locale, issue.dataset)} · {t("row")} {issue.row}:</b> {isArabic ? arMessage(issue.message) : issue.message}</li>)}</ul></div>}
        </>}
      </article>
    </div>
    <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"><ShieldCheck size={16} className="mt-1 shrink-0 text-teal" />{t("security")}</p>
    {vertical !== "medical" && <p className="text-xs text-slate-500">{t("patientOnly")}</p>}
  </section>;
}
