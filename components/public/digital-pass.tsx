/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import QRCode from "qrcode";
import Link from "next/link";
import { CalendarPlus, CheckCircle2, Copy, MapPin, QrCode, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localizedBranchName } from "@/lib/i18n/branch-name";

type ManualPayment = { mobileWalletLabel: string; mobileWalletNumber: string; instapayLink: string; instapayQrUrl: string; paymentInstructions: string };
type BookingInfo = { code: string; businessName: string; logoUrl: string | null; timezone: string; customerName: string; serviceName: string; branchName: string; branchNameAr?: string | null; branchNameEn?: string | null; branchAddress: string | null; branchMapUrl: string | null; providerName: string | null; startsAt: string; endsAt: string; status: string; paymentPreference: string; manualPayment: ManualPayment | null; bookingInvoice: { invoiceNumber: string; totalMinor: number; paidMinor: number; currency: string; paymentPreference: string } | null; customerResponse: string | null; canManage: boolean; ticketToken: string | null; branchId: string | null; serviceId: string; providerId: string | null; googleReviewUrl: string | null; packageInvoice: { invoiceNumber: string; totalMinor: number; paidMinor: number; currency: string; sessions: number; remainingSessions: number; paymentPreference: string } | null; bookingPolicy: { cancellationLeadMinutes: number; maxReschedules: number; depositRequired: boolean; depositPercentBps: number }; depositDueMinor: number; rescheduleCount: number };
type Slot = { startsAt: string; endsAt: string; providerId: string };

function formatDate(value: string, timezone: string, locale: string): string { return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { timeZone: timezone, dateStyle: "full" }).format(new Date(value)); }
function formatTime(value: string, timezone: string, locale: string): string { return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function getDateKey(value: string, timezone: string): string { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const part = (key: string) => parts.find((item) => item.type === key)?.value ?? ""; return `${part("year")}-${part("month")}-${part("day")}`; }
function plusDays(value: string, amount: number): string { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function statusLabel(status: string, locale: string): string { const labels = locale === "en" ? { pending: "Awaiting confirmation", confirmed: "Confirmed", waiting: "Waiting", in_progress: "Service started", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" } : { pending: "بانتظار التأكيد", confirmed: "مؤكد", waiting: "في قائمة الانتظار", in_progress: "بدأت الخدمة", completed: "مكتمل", cancelled: "ملغى", no_show: "لم يحضر" }; return (labels as Record<string, string>)[status] ?? status; }

export function DigitalPass({ slug, code, token, googleReviewUrl }: { slug: string; code: string; token: string; googleReviewUrl: string | null }) {
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [manageMessage, setManageMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const locale = useLocale();
  const isEnglish = locale === "en";
  const copy = isEnglish ? {
    loading: "Preparing your booking pass…", unavailable: "Unable to display the booking pass", back: "Back to venue page", digitalPass: "Digital booking pass", rescheduleRequested: "Reschedule requested", packageInvoice: "Session package invoice", serviceInvoice: "Service invoice", total: "Total", paid: "Paid", remaining: "Remaining", cashAtVisit: "Cash at visit", electronicRequest: "Electronic payment request", sessions: "Sessions remaining", transferInstructions: "Manual transfer instructions — payment not recorded", depositDue: "Deposit due now", transferReview: "The venue will review the transfer manually.", wallet: "Wallet", electronic: "electronic", openInstapay: "Open InstaPay", customer: "Customer", service: "Service", dateTime: "Date and time", branch: "Branch", provider: "Provider", bookingCode: "Booking code", directions: "Directions", qrAlt: "Booking QR code", scan: "Scan at arrival", addCalendar: "Add to Google Calendar", copyPass: "Copy pass link", copiedManage: "Booking management link copied", copiedPass: "Pass link copied", review: "Review visit", policy: "Changes and cancellation are available until", minutesBefore: "minutes before the appointment. Remaining reschedules:", reschedule: "Reschedule", cancel: "Cancel appointment", chooseDate: "Choose a new date", loadingSlots: "Loading slots…", noSlots: "No slots are available on this day.", confirmReschedule: "Confirm new appointment", updating: "Updating…", viewOnly: "This is a view-only pass. Use the management link sent after booking to cancel or change the appointment.", cancelConfirm: "Cancel this appointment?"
  } : {
    loading: "جارٍ تجهيز بطاقة الحجز…", unavailable: "تعذر عرض بطاقة الحجز", back: "العودة إلى صفحة المنشأة", digitalPass: "بطاقة الحجز الرقمية", rescheduleRequested: "طلب إعادة جدولة", packageInvoice: "فاتورة باقة الجلسات", serviceInvoice: "فاتورة الخدمة", total: "الإجمالي", paid: "المدفوع", remaining: "المتبقي", cashAtVisit: "نقداً عند الحضور", electronicRequest: "طلب دفع إلكتروني", sessions: "الجلسات المتبقية", transferInstructions: "تعليمات التحويل اليدوي — لم يُسجّل الدفع بعد", depositDue: "العربون المطلوب الآن", transferReview: "ستراجع المنشأة التحويل يدويًا.", wallet: "المحفظة", electronic: "الإلكترونية", openInstapay: "فتح رابط InstaPay", customer: "العميل", service: "الخدمة", dateTime: "التاريخ والوقت", branch: "الفرع", provider: "مقدم الخدمة", bookingCode: "رمز الحجز", directions: "الاتجاهات", qrAlt: "رمز QR لبطاقة الحجز", scan: "امسح الرمز عند الوصول", addCalendar: "إضافة إلى Google Calendar", copyPass: "نسخ رابط البطاقة", copiedManage: "تم نسخ رابط إدارة الحجز", copiedPass: "تم نسخ رابط البطاقة", review: "قيّم الزيارة", policy: "مهلة التعديل والإلغاء: حتى", minutesBefore: "دقيقة قبل الموعد. إعادة الجدولة المتبقية:", reschedule: "إعادة الجدولة", cancel: "إلغاء الموعد", chooseDate: "اختر تاريخاً جديداً", loadingSlots: "جارٍ تحميل الفترات…", noSlots: "لا توجد أوقات متاحة في اليوم المحدد.", confirmReschedule: "تأكيد الموعد الجديد", updating: "جارٍ التحديث…", viewOnly: "هذه بطاقة عرض فقط. استخدم رابط الإدارة الذي وصلك بعد الحجز لإلغاء الموعد أو تغييره.", cancelConfirm: "هل تريد إلغاء هذا الموعد؟"
  };
  const passPath = `/${encodeURIComponent(slug)}/booking/${encodeURIComponent(code)}`;
  const passUrl = typeof window === "undefined" ? passPath : `${window.location.origin}${passPath}`;
  const dateMinimum = booking ? getDateKey(new Date().toISOString(), booking.timezone) : "";
  const managementUrl = useMemo(() => typeof window === "undefined" ? passPath : `${window.location.origin}${passPath}?token=${encodeURIComponent(token)}`, [passPath, token]);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
      const response = await fetch(`/api/public/bookings/${encodeURIComponent(code)}${suffix}`, { cache: "no-store" });
      const data = await response.json() as { booking?: BookingInfo; error?: string };
      if (!response.ok || !data.booking) throw new Error(data.error ?? copy.unavailable);
      setBooking(data.booking);
      setDate(getDateKey(data.booking.startsAt, data.booking.timezone));
      const image = data.booking.ticketToken ? await QRCode.toDataURL(data.booking.ticketToken, { errorCorrectionLevel: "M", margin: 2, width: 240, color: { dark: "#0F172A", light: "#FFFFFF" } }) : "";
      setQr(image);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.unavailable); }
    finally { setLoading(false); }
  // The locale-derived copy is read for fallback text; locale changes remount the pass safely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, passUrl, token]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!rescheduleOpen || !booking || !booking.branchId || !date) return;
    const controller = new AbortController(); setSlotsLoading(true); setSelectedSlot(null); setManageMessage("");
    const query = new URLSearchParams({ branchId: booking.branchId, serviceId: booking.serviceId, date, providerId: "any" });
    void fetch(`/api/public/booking/${encodeURIComponent(slug)}/slots?${query}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { slots?: Slot[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.noSlots);
      setSlots(data.slots ?? []);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setManageMessage(reason instanceof Error ? reason.message : copy.noSlots); }).finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    return () => controller.abort();
  // The locale-derived copy is read for fallback text; locale changes remount the pass safely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleOpen, booking, date, slug]);

  async function cancelBooking() {
    if (!token || !window.confirm(copy.cancelConfirm)) return;
    setBusy(true); setManageMessage("");
    try { const response = await fetch(`/api/public/bookings/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", token }) }); const data = await response.json() as { error?: string; notificationWarning?: string | null }; if (!response.ok) throw new Error(data.error ?? copy.cancel); await reload(); setManageMessage(data.notificationWarning ?? copy.cancel); }
    catch (reason) { setManageMessage(reason instanceof Error ? reason.message : copy.cancel); }
    finally { setBusy(false); }
  }

  async function rescheduleBooking() {
    if (!token || !selectedSlot) return;
    setBusy(true); setManageMessage("");
    try { const response = await fetch(`/api/public/bookings/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reschedule", token, startsAt: selectedSlot.startsAt, providerId: selectedSlot.providerId }) }); const data = await response.json() as { error?: string; notificationWarning?: string | null }; if (!response.ok) throw new Error(data.error ?? copy.confirmReschedule); setRescheduleOpen(false); await reload(); setManageMessage(data.notificationWarning ?? copy.confirmReschedule); }
    catch (reason) { setManageMessage(reason instanceof Error ? reason.message : copy.confirmReschedule); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="mx-auto max-w-2xl rounded-3xl bg-white p-10 text-center shadow-sm">{copy.loading}</div>;
  if (!booking) return <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-navy">{copy.unavailable}</h1><p className="mt-2 text-sm text-red-700">{error}</p><Link href={`/${encodeURIComponent(slug)}`} className="mt-4 inline-block text-sm text-teal underline">{copy.back}</Link></div>;
  const start = new Date(booking.startsAt);
  const branchName = localizedBranchName({ branchName: booking.branchName, branchNameAr: booking.branchNameAr, branchNameEn: booking.branchNameEn }, locale);
  const end = new Date(booking.endsAt);
  const googleUrl = new URL("https://calendar.google.com/calendar/render");
  googleUrl.searchParams.set("action", "TEMPLATE");
  googleUrl.searchParams.set("text", `${booking.serviceName} — ${booking.businessName}`);
  googleUrl.searchParams.set("dates", `${start.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z")}/${end.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z")}`);
  googleUrl.searchParams.set("details", `${isEnglish ? "Booking code" : "رمز الحجز"}: ${booking.code}\n${isEnglish ? "Provider" : "مقدم الخدمة"}: ${booking.providerName ?? (isEnglish ? "Any available" : "أي متاح")}`);
  googleUrl.searchParams.set("location", [booking.businessName, branchName, booking.branchAddress].filter(Boolean).join(", "));
  const withinPolicyWindow = start.getTime() >= Date.now() + booking.bookingPolicy.cancellationLeadMinutes * 60_000;
  const canCancel = booking.canManage && ["pending", "confirmed"].includes(booking.status) && withinPolicyWindow;
  const canReschedule = canCancel && booking.rescheduleCount < booking.bookingPolicy.maxReschedules;
  const reviewLink = booking.googleReviewUrl ?? googleReviewUrl;
  return <section className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl" dir={isEnglish ? "ltr" : "rtl"}>
    <div className="bg-navy px-6 py-6 text-white"><div className="flex items-center justify-between"><div><p className="text-sm text-teal-200">{copy.digitalPass}</p><h1 className="mt-1 text-2xl font-bold">{booking.businessName}</h1></div>{booking.status === "cancelled" ? <XCircle className="text-red-300" size={34} /> : <CheckCircle2 className="text-teal-200" size={34} />}</div><div className="mt-4 flex items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-sm">{statusLabel(booking.status, locale)}</span>{booking.customerResponse === "reschedule_requested" && <span className="rounded-full bg-amber-300/20 px-3 py-1 text-sm text-amber-100">{copy.rescheduleRequested}</span>}</div></div>
    {booking.packageInvoice && <div className="border-b border-slate-100 bg-teal/5 px-6 py-4"><p className="font-bold text-navy">{copy.packageInvoice} · {booking.packageInvoice.invoiceNumber}</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600"><span>{copy.total}: {new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.packageInvoice.currency }).format(booking.packageInvoice.totalMinor / 100)}</span><span>{copy.remaining}: {new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.packageInvoice.currency }).format((booking.packageInvoice.totalMinor - booking.packageInvoice.paidMinor) / 100)} · {booking.packageInvoice.paymentPreference === "cash_at_visit" ? copy.cashAtVisit : copy.electronicRequest}</span><span>{copy.sessions}: {booking.packageInvoice.remainingSessions} {isEnglish ? "of" : "من"} {booking.packageInvoice.sessions}</span></div></div>}
    {booking.bookingInvoice && !booking.packageInvoice && <div className="border-b border-slate-100 bg-teal/5 px-6 py-4"><p className="font-bold text-navy">{copy.serviceInvoice} · {booking.bookingInvoice.invoiceNumber}</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600"><span>{copy.total}: {new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.bookingInvoice.currency }).format(booking.bookingInvoice.totalMinor / 100)}</span><span>{copy.paid}: {new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.bookingInvoice.currency }).format(booking.bookingInvoice.paidMinor / 100)}</span><span>{copy.remaining}: {new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.bookingInvoice.currency }).format((booking.bookingInvoice.totalMinor - booking.bookingInvoice.paidMinor) / 100)} · {booking.bookingInvoice.paymentPreference === "cash_at_visit" ? copy.cashAtVisit : copy.electronicRequest}</span></div></div>}
    {booking.paymentPreference === "electronic_requested" && booking.manualPayment && <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-950"><p className="font-bold">{copy.transferInstructions}</p>{booking.depositDueMinor > 0 && <p>{copy.depositDue}: <strong>{new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG-u-nu-latn", { style: "currency", currency: booking.bookingInvoice?.currency ?? booking.packageInvoice?.currency ?? "EGP" }).format(booking.depositDueMinor / 100)}</strong>. {copy.transferReview}</p>}{booking.manualPayment.mobileWalletNumber && <p>{copy.wallet} {booking.manualPayment.mobileWalletLabel || copy.electronic}: <bdi dir="ltr" className="font-mono font-semibold">{booking.manualPayment.mobileWalletNumber}</bdi></p>}{booking.manualPayment.instapayLink && <a href={booking.manualPayment.instapayLink} target="_blank" rel="noreferrer" className="inline-block font-semibold text-teal underline">{copy.openInstapay}</a>}{booking.manualPayment.instapayQrUrl && <a href={booking.manualPayment.instapayQrUrl} target="_blank" rel="noreferrer"><img src={booking.manualPayment.instapayQrUrl} alt={isEnglish ? "Venue InstaPay QR code" : "رمز InstaPay الخاص بالمنشأة"} referrerPolicy="no-referrer" className="mt-2 max-h-56 rounded-lg border border-amber-200 bg-white object-contain p-2" /></a>}{booking.manualPayment.paymentInstructions && <p className="whitespace-pre-wrap">{booking.manualPayment.paymentInstructions}</p>}</div>}
    <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:p-8"><div className="space-y-4"><div><p className="text-xs text-slate-500">{copy.customer}</p><p className="mt-1 font-semibold text-navy">{booking.customerName}</p></div><div><p className="text-xs text-slate-500">{copy.service}</p><p className="mt-1 font-semibold text-navy">{booking.serviceName}</p></div><div><p className="text-xs text-slate-500">{copy.dateTime}</p><p className="mt-1 font-semibold text-navy">{formatDate(booking.startsAt, booking.timezone, locale)}</p><p className="text-sm text-slate-600">{formatTime(booking.startsAt, booking.timezone, locale)} — {formatTime(booking.endsAt, booking.timezone, locale)} ({booking.timezone})</p></div><div><p className="text-xs text-slate-500">{copy.branch}</p><p className="mt-1 font-semibold text-navy">{branchName}</p>{booking.branchAddress && <p className="text-sm text-slate-600">{booking.branchAddress}</p>}{booking.branchMapUrl && <a className="mt-1 inline-flex items-center gap-1 text-sm text-teal underline" href={booking.branchMapUrl} target="_blank" rel="noreferrer"><MapPin size={14} />{copy.directions}</a>}</div>{booking.providerName && <div><p className="text-xs text-slate-500">{copy.provider}</p><p className="mt-1 font-semibold text-navy">{booking.providerName}</p></div>}<div className="border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">{copy.bookingCode}</p><p className="mt-1 font-mono text-lg font-bold tracking-widest text-teal" dir="ltr">{booking.code}</p></div></div>
      <div className="mx-auto text-center"><div className="grid size-56 place-items-center rounded-2xl border border-slate-200 bg-white p-2">{qr ? <img src={qr} alt={copy.qrAlt} className="size-full" /> : <QrCode className="text-slate-400" size={48} />}</div><p className="mt-2 text-xs text-slate-500">{copy.scan}</p></div></div>
    <div className="flex flex-wrap gap-2 border-t border-slate-100 p-5"><a href={googleUrl.toString()} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-white"><CalendarPlus size={16} />{copy.addCalendar}</a><button type="button" onClick={() => void navigator.clipboard.writeText(token ? managementUrl : passUrl).then(() => setManageMessage(token ? copy.copiedManage : copy.copiedPass))} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-navy"><Copy size={15} />{copy.copyPass}</button>{reviewLink && booking.status === "completed" && <a href={reviewLink} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-navy">{copy.review}</a>}</div>
    {(canCancel || canReschedule) && <div className="border-t border-slate-100 p-5"><p className="mb-3 text-xs text-slate-500">{copy.policy} {booking.bookingPolicy.cancellationLeadMinutes} {copy.minutesBefore} {Math.max(0, booking.bookingPolicy.maxReschedules - booking.rescheduleCount)}.</p><div className="flex flex-wrap gap-2">{canReschedule && <Button type="button" variant="outline" disabled={busy} onClick={() => setRescheduleOpen((open) => !open)}><RefreshCw size={16} />{copy.reschedule}</Button>}{canCancel && <Button type="button" variant="destructive" disabled={busy} onClick={() => void cancelBooking()}><XCircle size={16} />{copy.cancel}</Button>}</div>{rescheduleOpen && canReschedule && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><label className="block text-sm font-semibold text-navy">{copy.chooseDate}<input type="date" lang={isEnglish ? "en-GB" : "ar-EG"} dir={isEnglish ? "ltr" : "rtl"} value={date} min={dateMinimum} max={plusDays(dateMinimum, 90)} onChange={(event) => setDate(event.target.value)} className="mt-2 block rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>{slotsLoading ? <p className="mt-3 text-sm text-slate-500">{copy.loadingSlots}</p> : <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{slots.map((slot) => <button key={slot.startsAt} type="button" onClick={() => setSelectedSlot(slot)} className={`rounded-lg border px-2 py-2 text-sm ${selectedSlot?.startsAt === slot.startsAt ? "border-teal bg-teal text-white" : "border-slate-200 bg-white text-navy"}`}>{formatTime(slot.startsAt, booking.timezone, locale)}</button>)}</div>}{slots.length === 0 && !slotsLoading && <p className="mt-3 text-sm text-slate-600">{copy.noSlots}</p>}<Button type="button" className="mt-4" disabled={busy || !selectedSlot} onClick={() => void rescheduleBooking()}>{busy ? copy.updating : copy.confirmReschedule}</Button></div>}</div>}
    {manageMessage && <p role="status" className="border-t border-slate-100 px-5 py-3 text-sm text-teal">{manageMessage}</p>}
    {!booking.canManage && <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{copy.viewOnly}</p>}
  </section>;
}
