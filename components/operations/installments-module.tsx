"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate, formatMoney, InputField, Loading, ModuleTitle, Notice, SelectField } from "@/components/operations/shared";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Schedule = { id: string; contractId: string; installmentNumber: number; dueAt: string; amountMinor: number; paidMinor: number; remainingMinor: number; customerName: string | null; invoiceNumber: string; branchName: string | null; branchNameAr?: string | null; branchNameEn?: string | null };

export function InstallmentsModule() {
  const t = useTranslations("operationsRemaining");
  const locale = useLocale();

  const [dueThisMonth, setDueThisMonth] = useState<Schedule[]>([]);
  const [overdue, setOverdue] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>({});

  const methods = [
    { value: "cash", label: t("methods.cash") },
    { value: "card", label: t("methods.card") },
    { value: "wallet", label: t("methods.wallet") },
    { value: "instapay", label: t("methods.instapay") },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ dueThisMonth: Schedule[]; overdue: Schedule[] }>("/api/ops/installments");
      setDueThisMonth(result.dueThisMonth);
      setOverdue(result.overdue);
      setAmounts((current) =>
        Object.fromEntries(
          [...result.dueThisMonth, ...result.overdue].map((row) => [
            row.id,
            current[row.id] ?? (row.remainingMinor / 100).toFixed(2),
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function collect(row: Schedule) {
    setBusy(row.id);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/ops/installments/${encodeURIComponent(row.contractId)}/payments`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          scheduleId: row.id,
          amount: Number(amounts[row.id] || 0),
          method: paymentMethods[row.id] ?? "cash",
          reference: null,
        }),
      });
      await load();
      setMessage(t("collectSuccess", { installmentNumber: row.installmentNumber, invoiceNumber: row.invoiceNumber }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("collectError"));
    } finally {
      setBusy("");
    }
  }

  const renderRows = (rows: Schedule[], empty: string) =>
    rows.length ? (
      <div className="space-y-2">
        {rows.map((row) => (
          <article key={row.id} className="grid gap-3 rounded-xl bg-slate-50 p-3 lg:grid-cols-[1fr_auto_auto_auto_auto]">
            <div>
              <strong className="text-sm text-navy">
                {row.customerName ?? t("unregisteredCustomer")} · {row.invoiceNumber}
              </strong>
              <p className="mt-1 text-xs text-slate-500">
                {t("installmentPrefix")} {row.installmentNumber} · {localizedBranchName(row, locale) || "—"} · {t("duePrefix")} {formatDate(row.dueAt, false, locale)}
              </p>
            </div>
            <strong className="self-center text-sm text-navy">{formatMoney(row.remainingMinor, locale)}</strong>
            <InputField
              label={t("amountLabel")}
              type="number"
              min="0.01"
              max={row.remainingMinor / 100}
              step="0.01"
              value={amounts[row.id] ?? ""}
              onChange={(value) => setAmounts((current) => ({ ...current, [row.id]: value }))}
            />
            <SelectField
              label={t("methodLabel")}
              value={paymentMethods[row.id] ?? "cash"}
              onChange={(value) => setPaymentMethods((current) => ({ ...current, [row.id]: value }))}
              options={methods}
            />
            <Button className="self-end" disabled={busy === row.id} onClick={() => void collect(row)}>
              <Check size={16} /> {busy === row.id ? t("saving") : t("collectButton")}
            </Button>
          </article>
        ))}
      </div>
    ) : (
      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>
    );

  if (loading) return <Loading />;

  return (
    <section className="space-y-6">
      <ModuleTitle
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw size={16} /> {t("refresh")}
          </Button>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-teal/20 bg-teal/5 p-5">
          <p className="text-sm text-teal-900">{t("tile.dueThisMonth")}</p>
          <strong className="mt-2 block text-3xl text-navy">{dueThisMonth.length}</strong>
          <p className="mt-1 text-xs text-slate-600">
            {t("total")} {formatMoney(dueThisMonth.reduce((sum, row) => sum + row.remainingMinor, 0), locale)}
          </p>
        </article>
        <article className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm text-rose-900">{t("tile.overdue")}</p>
          <strong className="mt-2 block text-3xl text-navy">{overdue.length}</strong>
          <p className="mt-1 text-xs text-slate-600">
            {t("total")} {formatMoney(overdue.reduce((sum, row) => sum + row.remainingMinor, 0), locale)}
          </p>
        </article>
      </div>
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-navy">{t("heading.overdue")}</h2>
        {renderRows(overdue, t("empty.overdue"))}
      </section>
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-navy">{t("heading.dueThisMonth")}</h2>
        {renderRows(dueThisMonth, t("empty.dueThisMonth"))}
      </section>
    </section>
  );
}
