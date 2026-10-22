"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { apiRequest, EmptyState, InputField, Loading, ModuleTitle, Notice, SelectField } from "@/components/operations/shared";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type Account = { id: string; name: string; accountType: "cash" | "bank"; branchId: string | null; currency: string; balanceMinor: number; isActive: boolean };
type LedgerEntry = { id: string; accountId: string; branchId: string | null; routeId: string | null; salesRepId: string | null; tripId: string | null; direction: "in" | "out"; category: string; isOperatingExpense: boolean; amountMinor: number; currency: string; description: string; reference: string | null; reversalOfId: string | null; createdAt: string | Date };
type Bucket = { id: string; name: string; salesMinor: number; cogsMinor: number; operatingExpensesMinor: number; commissionMinor: number; grossProfitMinor: number; netProfitMinor: number };
type Report = { period: { from: string; to: string; branchId: string | null }; totals: { salesMinor: number; cogsMinor: number; writeOffMinor: number; operatingExpensesMinor: number; commissionMinor: number; grossProfitMinor: number; netProfitMinor: number; collectedMinor: number; invoiceCount: number }; byRep: Bucket[]; byRoute: Bucket[]; accountingBasis: string };
type Props = { branches: Branch[] };
const dateNow = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${dateNow().slice(0, 8)}01`;
const newKey = () => crypto.randomUUID();

export function TreasuryModule({ branches }: Props) {
  const { locale } = useDataLocale();
  const en = locale === "en";
  const t = useTranslations("reports-distribution-treasury");
  const text = {
    title: t("treasuryTitle"), desc: t("treasuryDescription"), branch: t("branchScope"), all: t("allBranches"), account: t("account"), cash: t("cashBox"), bank: t("bankAccount"), name: t("accountName"), bankName: t("bankName"), reference: t("accountReference"), opening: t("openingBalance"), createAccount: t("createAccount"), type: t("entryType"), receipt: t("receiptVoucher"), expense: t("operatingExpense"), disbursement: t("disbursement"), category: t("category"), amount: t("amount"), description: t("description"), route: t("routeOptional"), rep: t("repOptional"), referenceNo: t("referenceOptional"), record: t("recordEntry"), emptyAccounts: t("emptyAccounts"), emptyEntries: t("emptyEntries"), error: t("treasuryLoadError"), saved: t("entrySaved"), reverse: t("reverse"), reversalReason: t("reversalReason"), reversed: t("reversalRecorded"), period: t("reportPeriod"), from: t("from"), to: t("to"), refreshReport: t("refreshReport"), revenue: t("salesRevenue"), cogs: t("cogsWriteoffs"), gross: t("grossProfit"), expenses: t("operatingExpenses"), commission: t("repCommission"), net: t("netProfit"), collections: t("cashCollected"), invoiceCount: t("invoices"), byRep: t("profitByRep"), byRoute: t("profitByRoute"), sales: t("sales"), unitsCost: t("cost"), netProfit: t("netProfit"), noSales: t("noSales"), note: t("accountingBasis"), actionFailed: t("actionFailed"), choose: t("choose"),
  };
  const categories = {
    customer_receipt: t("categoryCustomerReceipt"), other_receipt: t("categoryOtherReceipt"), transport: t("categoryTransport"), fuel: t("categoryFuel"), loading: t("categoryLoading"), rent: t("categoryRent"), salary: t("categorySalary"), petty_cash: t("categoryPettyCash"), supplier: t("categorySupplier"), owner_draw: t("categoryOwnerDraw"), other: t("categoryOther"),
  };
  const [branchId, setBranchId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(dateNow());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accountForm, setAccountForm] = useState({ accountType: "cash" as "cash" | "bank", name: "", bankName: "", accountReference: "", openingBalance: "0" });
  const [form, setForm] = useState({ accountId: "", entryType: "receipt" as "receipt" | "expense" | "disbursement", category: "customer_receipt", amount: "", routeId: "", salesRepId: "", description: "", reference: "" });
  const [routes, setRoutes] = useState<Array<{ id: string; name: string }>>([]);
  const [reps, setReps] = useState<Array<{ id: string; fullName: string }>>([]);

  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [cash, reportData, routeData, repData] = await Promise.all([
        apiRequest<{ accounts: Account[]; transactions: LedgerEntry[] }>(`/api/ops/treasury${query}`),
        apiRequest<Report>(`/api/ops/financial-report?${new URLSearchParams({ ...(branchId ? { branchId } : {}), from, to }).toString()}`),
        apiRequest<{ routes: Array<{ id: string; name: string }> }>(`/api/ops/distribution/routes${query}`),
        apiRequest<{ reps: Array<{ id: string; fullName: string }> }>(`/api/ops/distribution/reps${query}`),
      ]);
      setAccounts(cash.accounts); setEntries(cash.transactions); setReport(reportData); setRoutes(routeData.routes); setReps(repData.reps);
      setForm((current) => ({ ...current, accountId: current.accountId && cash.accounts.some((account) => account.id === current.accountId) ? current.accountId : cash.accounts[0]?.id ?? "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : text.error); }
    finally { setLoading(false); }
  }, [branchId, from, to, query, text.error]);
  useEffect(() => { void load(); }, [load]);
  const categoriesForType = form.entryType === "receipt" ? ["customer_receipt", "other_receipt"] : form.entryType === "expense" ? ["transport", "fuel", "loading", "rent", "salary", "petty_cash", "other"] : ["supplier", "owner_draw", "other"];
  const execute = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : text.actionFailed); }
    finally { setBusy(false); }
  };
  const post = (body: unknown) => apiRequest("/api/ops/treasury", { method: "POST", body: JSON.stringify(body) });
  const format = (value: number) => new Intl.NumberFormat(en ? "en-EG" : "ar-EG-u-nu-latn", { style: "currency", currency: "EGP" }).format((value ?? 0) / 100);
  const reportCards = report ? [
    [text.revenue, report.totals.salesMinor], [text.cogs, report.totals.cogsMinor], [text.gross, report.totals.grossProfitMinor], [text.expenses, report.totals.operatingExpensesMinor], [text.commission, report.totals.commissionMinor], [text.net, report.totals.netProfitMinor], [text.collections, report.totals.collectedMinor],
  ] as Array<[string, number]> : [];

  return <section>
    <ModuleTitle eyebrow={t("financialControl")} title={text.title} description={text.desc} />
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}{message && <div className="mb-4"><Notice kind="success">{message}</Notice></div>}
    <div className="mb-5 max-w-sm"><SelectField label={text.branch} value={branchId} onChange={setBranchId} options={[{ value: "", label: text.all }, ...branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))]} /></div>
    {loading ? <Loading /> : <>
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold text-navy dark:text-slate-100">{text.period}</h2><p className="text-sm text-slate-500 dark:text-slate-300">{report?.totals.invoiceCount ?? 0} {text.invoiceCount}</p></div><div className="flex flex-wrap gap-2"><InputField label={text.from} type="date" value={from} onChange={setFrom} /><InputField label={text.to} type="date" value={to} onChange={setTo} /><Button type="button" variant="outline" onClick={() => void load()}>{text.refreshReport}</Button></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{reportCards.map(([label, value]) => <article key={label} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3"><p className="text-xs text-slate-500 dark:text-slate-300">{label}</p><strong className={`mt-1 block text-lg ${label === text.net ? value >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300" : "text-navy dark:text-slate-100"}`}>{format(value)}</strong></article>)}</div><p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-300">{text.note}: {t("accountingBasisDescription")}</p></section>
      <div className="mb-6 grid gap-5 xl:grid-cols-2">{[[text.byRep, report?.byRep ?? []], [text.byRoute, report?.byRoute ?? []]].map(([title, rows]) => <section key={String(title)} className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5"><h2 className="mb-3 font-bold text-navy dark:text-slate-100">{title as string}</h2>{(rows as Bucket[]).length ? <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead><tr className="border-b text-start text-xs text-slate-500 dark:text-slate-300"><th className="py-2 text-start">{t("nameHeader")}</th><th className="py-2 text-end">{text.sales}</th><th className="py-2 text-end">{text.unitsCost}</th><th className="py-2 text-end">{text.netProfit}</th></tr></thead><tbody>{(rows as Bucket[]).map((row) => <tr key={row.id} className="border-b border-slate-100 dark:border-slate-700"><td className="py-2 font-medium text-navy dark:text-slate-100">{row.name}</td><td className="py-2 text-end">{format(row.salesMinor)}</td><td className="py-2 text-end">{format(row.cogsMinor)}</td><td className={`py-2 text-end font-semibold ${row.netProfitMinor >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{format(row.netProfitMinor)}</td></tr>)}</tbody></table></div> : <EmptyState title={text.noSales} detail={t("linkInvoicesToTrip")} />}</section>)}</div>
      <div className="grid gap-5 xl:grid-cols-2">
        <form className="space-y-3 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5" onSubmit={(event) => { event.preventDefault(); void execute(() => post({ action: "create_account", branchId: branchId || null, accountType: accountForm.accountType, name: accountForm.name, bankName: accountForm.bankName || null, accountReference: accountForm.accountReference || null, openingBalance: Number(accountForm.openingBalance || 0) }), t("accountCreated")); }}><h2 className="font-bold text-navy dark:text-slate-100">{text.createAccount}</h2><div className="grid gap-3 sm:grid-cols-2"><SelectField label={text.account} value={accountForm.accountType} onChange={(value) => setAccountForm({ ...accountForm, accountType: value as "cash" | "bank" })} options={[{ value: "cash", label: text.cash }, { value: "bank", label: text.bank }]} /><InputField label={text.name} value={accountForm.name} onChange={(value) => setAccountForm({ ...accountForm, name: value })} required /></div>{accountForm.accountType === "bank" && <div className="grid gap-3 sm:grid-cols-2"><InputField label={text.bankName} value={accountForm.bankName} onChange={(value) => setAccountForm({ ...accountForm, bankName: value })} /><InputField label={text.reference} value={accountForm.accountReference} onChange={(value) => setAccountForm({ ...accountForm, accountReference: value })} /></div>}<InputField label={text.opening} type="number" min="0" step="0.01" value={accountForm.openingBalance} onChange={(value) => setAccountForm({ ...accountForm, openingBalance: value })} /><Button disabled={busy} type="submit">{text.createAccount}</Button></form>
        <form className="space-y-3 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5" onSubmit={(event) => { event.preventDefault(); void execute(() => post({ action: "record", accountId: form.accountId, entryType: form.entryType, category: form.category, amount: Number(form.amount), branchId: branchId || null, routeId: form.routeId || null, salesRepId: form.salesRepId || null, description: form.description, reference: form.reference || null, idempotencyKey: newKey() }), text.saved); }}><h2 className="font-bold text-navy dark:text-slate-100">{text.record}</h2><div className="grid gap-3 sm:grid-cols-2"><SelectField label={text.account} value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value })} options={accounts.filter((account) => account.isActive).map((account) => ({ value: account.id, label: `${account.name} · ${format(account.balanceMinor)}` }))} required /><SelectField label={text.type} value={form.entryType} onChange={(value) => { const entryType = value as typeof form.entryType; setForm({ ...form, entryType, category: entryType === "receipt" ? "customer_receipt" : entryType === "expense" ? "transport" : "supplier" }); }} options={[{ value: "receipt", label: text.receipt }, { value: "expense", label: text.expense }, { value: "disbursement", label: text.disbursement }]} /></div><div className="grid gap-3 sm:grid-cols-2"><SelectField label={text.category} value={form.category} onChange={(value) => setForm({ ...form, category: value })} options={categoriesForType.map((key) => ({ value: key, label: categories[key as keyof typeof categories] }))} /><InputField label={text.amount} type="number" min="0.01" step="0.01" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} required /></div><InputField label={text.description} value={form.description} onChange={(value) => setForm({ ...form, description: value })} required /><div className="grid gap-3 sm:grid-cols-2"><SelectField label={text.route} value={form.routeId} onChange={(value) => setForm({ ...form, routeId: value })} options={[{ value: "", label: text.choose }, ...routes.map((route) => ({ value: route.id, label: route.name }))]} /><SelectField label={text.rep} value={form.salesRepId} onChange={(value) => setForm({ ...form, salesRepId: value })} options={[{ value: "", label: text.choose }, ...reps.map((rep) => ({ value: rep.id, label: rep.fullName }))]} /></div><InputField label={text.referenceNo} value={form.reference} onChange={(value) => setForm({ ...form, reference: value })} /><Button disabled={busy || !form.accountId} type="submit">{text.record}</Button></form>
      </div>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5"><h2 className="mb-3 font-bold text-navy dark:text-slate-100">{text.account}</h2>{accounts.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <article key={account.id} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"><p className="text-xs text-slate-500 dark:text-slate-300">{account.accountType === "cash" ? text.cash : text.bank} · {account.currency}</p><strong className="mt-1 block text-navy dark:text-slate-100">{account.name}</strong><p className="mt-2 text-lg font-bold text-teal">{format(account.balanceMinor)}</p></article>)}</div> : <EmptyState title={text.emptyAccounts} detail={text.createAccount} />}</section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5"><h2 className="mb-3 font-bold text-navy dark:text-slate-100">{t("latestEntries")}</h2>{entries.length ? <div className="space-y-2">{entries.map((entry) => <article key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><div><strong className="text-sm text-navy dark:text-slate-100">{entry.description}</strong><p className="text-xs text-slate-500 dark:text-slate-300">{categories[entry.category as keyof typeof categories] ?? entry.category} · {new Intl.DateTimeFormat(en ? "en-GB" : "ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}{entry.reference ? ` · ${entry.reference}` : ""}{entry.reversalOfId ? ( ` · ${t("reversal")}`) : ""}</p></div><div className="flex items-center gap-2"><strong className={entry.direction === "in" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>{entry.direction === "in" ? "+" : "−"}{format(entry.amountMinor)}</strong>{!entry.reversalOfId && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { const reason = window.prompt(text.reversalReason); if (reason?.trim()) void execute(() => post({ action: "reverse", transactionId: entry.id, reason }), text.reversed); }}>{text.reverse}</Button>}</div></article>)}</div> : <EmptyState title={text.emptyEntries} detail={t("createReceiptExpense")} />}</section>
    </>}
  </section>;
}
