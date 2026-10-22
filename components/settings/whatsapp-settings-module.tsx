"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, KeyRound, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readJsonResponse } from "@/lib/http/safe-json";

type WhatsAppMode = "basic" | "advanced";
type Connection = { phoneNumberId: string; businessAccountId: string | null; webhookVerifyToken: string | null; webhookUrl: string | null; defaultTemplateName: string | null; confirmationTemplate: string; reminderTemplate: string; reminderThreeHourTemplate: string; reviewTemplate: string; languageCode: string; isActive: boolean; tokenConfigured: boolean };
type State = { mode: WhatsAppMode; basicPhoneNumber: string; advancedAvailable: boolean; connection: Connection | null; appWebhookReady: boolean; encryptionReady: boolean };
type NotificationDate = { iso: string; date: string; time: string } | null;
type WhatsAppNotification = { id: string; eventKind: string; status: string; attempts: number; recipientPhone: string; lastError: string | null; canRetry: boolean; scheduledAt: NotificationDate; updatedAt: NotificationDate };
type AdvancedForm = { phoneNumberId: string; businessAccountId: string; accessToken: string; webhookVerifyToken: string; webhookUrl: string; defaultTemplateName: string; confirmationTemplate: string; reminderTemplate: string; reminderThreeHourTemplate: string; reviewTemplate: string; languageCode: string };
const advancedDefaults: AdvancedForm = { phoneNumberId: "", businessAccountId: "", accessToken: "", webhookVerifyToken: "", webhookUrl: "", defaultTemplateName: "qutoof_appointment_confirmation", confirmationTemplate: "qutoof_appointment_confirmation", reminderTemplate: "qutoof_appointment_reminder", reminderThreeHourTemplate: "qutoof_appointment_reminder_3h", reviewTemplate: "qutoof_appointment_review", languageCode: "ar" };
const fallbackState: State = { mode: "basic", basicPhoneNumber: "", advancedAvailable: true, connection: null, appWebhookReady: false, encryptionReady: true };

export function WhatsAppSettingsModule() {
  const t = useTranslations("settings-whatsapp");
  const [state, setState] = useState<State | null>(null);
  const [mode, setMode] = useState<WhatsAppMode>("basic");
  const [basicPhoneNumber, setBasicPhoneNumber] = useState("");
  const [form, setForm] = useState(advancedDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifications, setNotifications] = useState<WhatsAppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function refreshNotifications() {
    const locale = document.documentElement.lang === "en" ? "en" : "ar";
    const response = await fetch(`/api/ops/whatsapp/notifications?locale=${locale}`, { cache: "no-store", headers: { Accept: "application/json" } });
    const data = await readJsonResponse<{ notifications: WhatsAppNotification[] }>(response, t("whatsapp.loadError"));
    setNotifications(data.notifications ?? []);
  }

  async function refresh() {
    try {
      const response = await fetch("/api/ops/whatsapp", { cache: "no-store", headers: { Accept: "application/json" } });
      const data = await readJsonResponse<State>(response, t("whatsapp.loadError"));
      setState(data);
      setMode(data.mode === "advanced" ? "advanced" : "basic");
      setBasicPhoneNumber(data.basicPhoneNumber ?? "");
      if (data.connection) setForm({ phoneNumberId: data.connection.phoneNumberId, businessAccountId: data.connection.businessAccountId ?? "", accessToken: "", webhookVerifyToken: data.connection.webhookVerifyToken ?? "", webhookUrl: data.connection.webhookUrl ?? "", defaultTemplateName: data.connection.defaultTemplateName ?? data.connection.confirmationTemplate, confirmationTemplate: data.connection.confirmationTemplate, reminderTemplate: data.connection.reminderTemplate, reminderThreeHourTemplate: data.connection.reminderThreeHourTemplate, reviewTemplate: data.connection.reviewTemplate, languageCode: data.connection.languageCode });
    } catch (error) {
      setState(fallbackState);
      throw error;
    }
  }

  // refresh is intentionally kept local to this stateful settings module.
  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/whatsapp`);
    void Promise.all([refresh(), refreshNotifications()]).catch((error: unknown) => { setState(fallbackState); setMessage(error instanceof Error ? error.message : t("whatsapp.loadError")); }).finally(() => { setLoading(false); setNotificationsLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function persist(payload: Record<string, unknown>, successMessage: string) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/ops/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await readJsonResponse<{ saved?: boolean }>(response, t("whatsapp.saveError"));
      setForm((current) => ({ ...current, accessToken: "" }));
      setMessage(successMessage);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("whatsapp.saveError")); }
    finally { setSaving(false); }
  }

  async function saveBasic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist({ mode: "basic", basicPhoneNumber }, t("whatsapp.basicSaved"));
  }

  async function saveAdvanced(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist({ mode: "advanced", ...form, businessAccountId: form.businessAccountId || null, webhookVerifyToken: form.webhookVerifyToken || null, webhookUrl: form.webhookUrl || null, defaultTemplateName: form.defaultTemplateName || null, ...(form.accessToken ? {} : { accessToken: undefined }) }, t("whatsapp.metaSaved"));
  }

  async function retryNotification(id: string) {
    setRetryingId(id);
    try {
      const response = await fetch("/api/ops/whatsapp/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      await readJsonResponse(response, t("whatsapp.retryError"));
      setMessage(t("whatsapp.retryQueued"));
      await refreshNotifications();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("whatsapp.retryError")); }
    finally { setRetryingId(null); }
  }

  function statusLabel(status: string) {
    const key = `whatsapp.status${status.charAt(0).toUpperCase()}${status.slice(1)}` as Parameters<typeof t>[0];
    return t(key);
  }

  if (loading) return <p className="text-sm text-muted">{t("whatsapp.loading")}</p>;
  return <section className="mx-auto max-w-3xl space-y-6">
    <header><p className="text-sm font-semibold text-teal">{t("whatsapp.eyebrow")}</p><h1 className="mt-1 text-2xl font-bold text-navy">{t("whatsapp.title")}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{t("whatsapp.intro")}</p></header>
    <div role="tablist" aria-label={t("whatsapp.modeAriaLabel")} className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
      <button id="whatsapp-basic-tab" type="button" role="tab" aria-controls="whatsapp-basic-panel" aria-selected={mode === "basic"} onClick={() => { setMode("basic"); setMessage(""); }} className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === "basic" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}>{t("whatsapp.basic")}</button>
      <button id="whatsapp-advanced-tab" type="button" role="tab" aria-controls="whatsapp-advanced-panel" aria-selected={mode === "advanced"} onClick={() => { setMode("advanced"); setMessage(""); }} className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === "advanced" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}>{t("whatsapp.advanced")}</button>
    </div>

    {mode === "basic" ? <form id="whatsapp-basic-panel" role="tabpanel" aria-labelledby="whatsapp-basic-tab" onSubmit={saveBasic} className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><h2 className="font-bold text-navy">{t("whatsapp.quick")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("whatsapp.quickHelp")}</p></div>
        <label className="block text-sm font-semibold text-navy">{t("whatsapp.businessPhone")}<input type="tel" autoComplete="tel" required minLength={8} maxLength={32} pattern="[+0-9() .-]{8,32}" value={basicPhoneNumber} onChange={(event) => setBasicPhoneNumber(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900" dir="ltr" placeholder={t("whatsapp.businessPhonePlaceholder")} /></label>
        <p className="text-sm leading-6 text-slate-600">{t("whatsapp.manualHelp")}</p>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={saving}><Save size={16} />{saving ? t("whatsapp.saving") : t("whatsapp.saveBasic")}</Button>{message && <span role="status" className="text-sm text-slate-700">{message}</span>}</div>
    </form> : <form id="whatsapp-advanced-panel" role="tabpanel" aria-labelledby="whatsapp-advanced-tab" onSubmit={saveAdvanced} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><ShieldCheck className={state?.encryptionReady ? "text-teal" : "text-amber-600"} size={18} />{t("whatsapp.encryption")}: {state?.encryptionReady ? t("whatsapp.configured") : t("whatsapp.missing")}</div><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><CheckCircle2 className={state?.appWebhookReady ? "text-teal" : "text-amber-600"} size={18} />{t("whatsapp.webhookSecrets")}: {state?.appWebhookReady ? t("whatsapp.configured") : t("whatsapp.missing")}</div></div>
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <label className="text-sm font-semibold text-navy">{t("whatsapp.phoneNumberId")}<input required value={form.phoneNumberId} onChange={(event) => update("phoneNumberId", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.businessAccountId")}<input value={form.businessAccountId} onChange={(event) => update("businessAccountId", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy sm:col-span-2">{t("whatsapp.accessToken")}{state?.connection?.tokenConfigured && <span className="ms-2 text-xs font-normal text-teal">{t("whatsapp.saved")}</span>}<input type="password" autoComplete="new-password" value={form.accessToken} onChange={(event) => update("accessToken", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" required={!state?.connection?.tokenConfigured} /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.webhookVerifyToken")}<input value={form.webhookVerifyToken} onChange={(event) => update("webhookVerifyToken", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.webhookUrl")}<input type="url" value={form.webhookUrl} onChange={(event) => update("webhookUrl", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" placeholder={webhookUrl} /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.defaultTemplateName")}<input value={form.defaultTemplateName} onChange={(event) => update("defaultTemplateName", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.confirmationTemplate")}<input required value={form.confirmationTemplate} onChange={(event) => update("confirmationTemplate", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.reminderTemplate")}<input required value={form.reminderTemplate} onChange={(event) => update("reminderTemplate", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.reminderThreeHourTemplate")}<input required value={form.reminderThreeHourTemplate} onChange={(event) => update("reminderThreeHourTemplate", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.reviewTemplate")}<input required value={form.reviewTemplate} onChange={(event) => update("reviewTemplate", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
        <label className="text-sm font-semibold text-navy">{t("whatsapp.languageCode")}<input required value={form.languageCode} onChange={(event) => update("languageCode", event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" dir="ltr" /></label>
      </section>
      <section className="space-y-3 rounded-2xl border border-teal/20 bg-teal/5 p-5 text-sm leading-6 text-slate-700"><h2 className="font-bold text-navy">{t("whatsapp.templates")}</h2><p>{t("whatsapp.confirmationHelp")}</p><p>{t("whatsapp.reminderHelp")}</p><p>{t("whatsapp.reminderThreeHourHelp")}</p><p>{t("whatsapp.reviewHelp")}</p><p>{t("whatsapp.webhook")}:</p><code className="block break-all rounded-lg bg-white p-3" dir="ltr">{webhookUrl || t("whatsapp.emptyUrl")}</code><p>{t("whatsapp.secretsHelp")}</p></section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={saving}><Save size={16} />{saving ? t("whatsapp.saving") : t("whatsapp.saveMeta")}</Button>{state?.connection?.tokenConfigured && <span className="inline-flex items-center gap-1 text-sm text-teal"><KeyRound size={15} />{t("whatsapp.tokenSaved")}</span>}{message && <span role="status" className="text-sm text-slate-700">{message}</span>}</div>
    </form>}
    <section aria-labelledby="whatsapp-notifications-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="whatsapp-notifications-title" className="font-bold text-navy">{t("whatsapp.notificationsTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("whatsapp.notificationsScope")}</p></div><Button type="button" variant="outline" onClick={() => { setNotificationsLoading(true); void refreshNotifications().finally(() => setNotificationsLoading(false)); }}><RefreshCw size={16} />{t("whatsapp.notificationsRefresh")}</Button></div>
      {notificationsLoading ? <p className="text-sm text-slate-500">{t("whatsapp.loading")}</p> : notifications.length === 0 ? <p className="text-sm text-slate-500">{t("whatsapp.notificationsEmpty")}</p> : <div className="space-y-3">{notifications.map((notification) => <article key={notification.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-navy">{t("whatsapp.eventKind")}: {notification.eventKind}</p><p className="mt-1 text-xs text-slate-500" dir="ltr">{notification.recipientPhone}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel(notification.status)}</span></div><div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3"><span>{t("whatsapp.scheduledAt")}: {notification.scheduledAt ? `${notification.scheduledAt.date} · ${notification.scheduledAt.time}` : "—"}</span><span>{t("whatsapp.updatedAt")}: {notification.updatedAt ? `${notification.updatedAt.date} · ${notification.updatedAt.time}` : "—"}</span><span>{t("whatsapp.attempts")}: {notification.attempts}</span></div>{notification.lastError && <p className="mt-2 text-xs text-red-700">{notification.lastError}</p>}{notification.canRetry && <Button type="button" variant="outline" size="sm" className="mt-3" disabled={retryingId === notification.id} onClick={() => void retryNotification(notification.id)}><RotateCcw size={14} />{retryingId === notification.id ? t("whatsapp.retrying") : t("whatsapp.retry")}</Button>}</article>)}</div>}
    </section>
  </section>;
}
