"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lightbulb, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, Notice, useAction, useLoad } from "@/components/operations/shared";

type RequestRow = { id: string; title: string; description: string; status: string; adminNote: string | null; createdAt: string | Date };
const statusKeys: Record<string, string> = { new: "featureRequest.status.new", under_review: "featureRequest.status.underReview", planned: "featureRequest.status.planned", declined: "featureRequest.status.declined", completed: "featureRequest.status.completed" };

export function FeatureRequestBox() {
  const t = useTranslations("remaining-platform-print");
  const { data, loading, reload } = useLoad<{ requests: RequestRow[] }>("/api/ops/feature-requests");
  const action = useAction();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const created = await action.execute(() => apiRequest("/api/ops/feature-requests", { method: "POST", body: JSON.stringify({ title, description }) }), t("featureRequest.success"));
    if (created) { setTitle(""); setDescription(""); await reload(); }
  }
  return <section className="rounded-2xl border border-teal/20 bg-teal/5 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal/10 text-teal"><Lightbulb size={21} /></span><div><h2 className="font-bold text-navy">{t("featureRequest.title")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("featureRequest.description")}</p></div></div><form onSubmit={submit} className="mt-5 grid gap-3"><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("featureRequest.titleLabel")}</span><input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={120} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" placeholder={t("featureRequest.titlePlaceholder")} /></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("featureRequest.descriptionLabel")}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} maxLength={2000} rows={3} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" placeholder={t("featureRequest.descriptionPlaceholder")} /></label><div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={action.busy}><Send size={16} />{action.busy ? t("featureRequest.submitting") : t("featureRequest.submit")}</Button>{action.success && <Notice kind="success">{action.success}</Notice>}{action.error && <Notice>{action.error}</Notice>}</div></form><div className="mt-6 border-t border-teal/10 pt-5"><h3 className="text-sm font-bold text-navy">{t("featureRequest.previous")}</h3>{loading ? <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p> : (data?.requests.length ?? 0) === 0 ? <p className="mt-3 text-sm text-slate-500">{t("featureRequest.empty")}</p> : <div className="mt-3 space-y-2">{data?.requests.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-navy">{item.title}</h4><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">{statusKeys[item.status] ? t(statusKeys[item.status]) : item.status}</span></div><p className="mt-1 text-xs leading-6 text-slate-600">{item.description}</p>{item.adminNote && <p className="mt-2 rounded-lg bg-teal/5 p-2 text-xs leading-5 text-teal">{t("featureRequest.adminNote")} {item.adminNote}</p>}</article>)}</div>}</div></section>;
}
