"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Download, LoaderCircle, MessageCircle, RefreshCw, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, formatDate, formatMoney } from "@/components/platform/api-client";

type BillingRequest = {
  id: string; tenantId: string; tenantName: string | null; tenantSlug: string | null; planName: string; billingCycle: string;
  amountMinor: number; currency: string; paymentMethod: string; status: string; rejectionReason: string | null;
  telegramMessageId: string | null; telegramSentAt: string | null; telegramAttempts: number; telegramLastError: string | null;
  createdAt: string; reviewedAt: string | null; receiptUrl: string; telegramStatus: string;
  requestKind?: "subscription" | "addon"; quantity?: number; resourceType?: string;
};
const statusKeys: Record<string, string> = { pending_review: "billingReview.status.pending", approved: "billingReview.status.approved", rejected: "billingReview.status.rejected", cancelled: "billingReview.status.cancelled", expired: "billingReview.status.expired" };

export function BillingReviewPanel() {
  const locale = useLocale();
  const t = useTranslations("remaining-platform-print");
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [filter, setFilter] = useState("pending_review");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const query = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const response = await apiRequest<{ requests: BillingRequest[] }>(`/api/super-admin/billing-requests${query}`);
      setRequests(response.requests);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billingReview.loadError")); }
  }, [filter, t]);
  useEffect(() => { void load(); }, [load]);

  async function retry(item: BillingRequest) {
    setBusyId(item.id); setError(""); setNotice("");
    try {
      const endpoint = item.requestKind === "addon" ? "addon-requests" : "billing-requests";
      const result = await apiRequest<{ sent: boolean }>(`/api/super-admin/${endpoint}/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry_notification" }) });
      setNotice(result.sent ? t("billingReview.retrySent") : t("billingReview.retryQueued"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billingReview.retryError")); }
    finally { setBusyId(""); }
  }

  async function decide(item: BillingRequest, action: "approve" | "reject") {
    if (item.requestKind !== "addon") return;
    const verb = action === "approve" ? t("billingReview.approveVerb") : t("billingReview.rejectVerb");
    if (!window.confirm(`${verb} — ${t("billingReview.confirmTenant")} «${item.tenantName ?? t("billingReview.unknownTenant")}»${locale === "ar" ? "؟" : "?"}`)) return;
    setBusyId(item.id); setError(""); setNotice("");
    try {
      await apiRequest(`/api/super-admin/addon-requests/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      setNotice(action === "approve" ? t("billingReview.approvedNotice") : t("billingReview.rejectedNotice"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("billingReview.reviewError")); }
    finally { setBusyId(""); }
  }

  return <section className="space-y-5" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal">{t("billingReview.eyebrow")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("billingReview.title")}</h1><p className="mt-2 text-sm text-slate-600">{t("billingReview.description")}</p></div><div className="flex gap-2"><select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="pending_review">{t("billingReview.filter.pending")}</option><option value="approved">{t("billingReview.filter.approved")}</option><option value="rejected">{t("billingReview.filter.rejected")}</option><option value="cancelled">{t("billingReview.filter.cancelled")}</option><option value="expired">{t("billingReview.filter.expired")}</option><option value="">{t("billingReview.filter.all")}</option></select><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15} />{t("common.refresh")}</Button></div></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-teal">{notice}</p>}
    <div className="space-y-3">{requests.map((item) => <article key={`${item.requestKind ?? "subscription"}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-navy">{item.tenantName ?? t("billingReview.unavailableTenant")}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{statusKeys[item.status] ? t(statusKeys[item.status]) : item.status}</span><span className="rounded-full bg-teal/10 px-2.5 py-1 text-xs text-teal">{item.requestKind === "addon" ? t("billingReview.addon") : t("billingReview.subscription")}</span></div><p className="mt-1 text-sm text-slate-600">/{item.tenantSlug ?? "—"} · {item.planName} · {item.billingCycle}{item.quantity ?  ` · ${t("billingReview.quantity")} ${item.quantity}` : ""}</p><p className="mt-1 text-sm font-semibold text-navy">{formatMoney(item.amountMinor, item.currency, locale)} · {item.paymentMethod === "instapay" ? t("billingReview.instapay") : t("billingReview.vodafoneCash")}</p><p className="mt-2 text-xs text-slate-500">{t("billingReview.requestNumber")}: <code dir="ltr">{item.id}</code> · {t("billingReview.sent")}: {formatDate(item.createdAt, locale)} · Telegram: {item.telegramSentAt ? `${t("billingReview.sentStatus")} ${formatDate(item.telegramSentAt, locale)}` : `${t("billingReview.awaitingStatus")} (${item.telegramAttempts} ${t("billingReview.attempts")})`}</p>{item.reviewedAt && <p className="mt-1 text-xs text-slate-500">{t("billingReview.reviewed")}: {formatDate(item.reviewedAt, locale)}</p>}{item.telegramLastError && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><p>{t("billingReview.notificationFailed")}: {item.telegramLastError}</p>{item.telegramLastError.toLowerCase().includes("telegram billing notifications are not configured") && <p className="mt-2 leading-5">{t("billingReview.notificationHelp")}</p>}</div>}{item.rejectionReason && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{item.rejectionReason}</p>}</div><div className="flex flex-wrap gap-2"><a href={item.receiptUrl} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-navy hover:bg-slate-50"><Download size={15} />{t("billingReview.downloadReceipt")}</a>{item.status === "pending_review" && !item.telegramSentAt && <Button variant="outline" size="sm" onClick={() => void retry(item)} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="animate-spin" size={15} /> : <RotateCw size={15} />}{t("billingReview.retry")}</Button>}{item.status === "pending_review" && item.requestKind === "addon" && <><Button size="sm" onClick={() => void decide(item, "approve")} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}{t("billingReview.approve")}</Button><Button variant="outline" size="sm" onClick={() => void decide(item, "reject")} disabled={busyId === item.id}><X size={15} />{t("billingReview.reject")}</Button></>}</div></div></article>)}{!requests.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><MessageCircle className="mx-auto mb-2" size={22} />{t("billingReview.empty")}</div>}</div>
  </section>;
}
