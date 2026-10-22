/* eslint-disable @next/next/no-img-element */
"use client";

import { PRODUCT_NAME } from "@/lib/brand";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Clock3, MapPin, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { getTerms, type Vertical } from "@/lib/terms";
import { Button } from "@/components/ui/button";
import { DigitalPass } from "@/components/public/digital-pass";
import { localizedBranchName } from "@/lib/i18n/branch-name";
import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";

type Branch = { id: string; name: string; nameAr?: string; nameEn?: string; address: string | null; phone: string | null; mapUrl: string | null };
type Service = { id: string; name: string; description: string | null; kind: string; priceMinor: number; currency: string; durationMinutes: number; sessionCount: number; branchId: string | null };
type Provider = { id: string; fullName: string };
type BusinessHour = { id: string; branchId: string | null; providerId: string | null; weekday: number; startsAt: string; endsAt: string };
type ManualPayment = { mobileWalletLabel: string; mobileWalletNumber: string; instapayLink: string; instapayQrUrl: string; paymentInstructions: string };
type Venue = { name: string; slug: string; vertical: Vertical; timezone: string; logoUrl: string | null; contactPhone: string | null; description: string; acceptElectronicRequest: boolean; manualPayment: ManualPayment | null; googleReviewUrl: string | null; bookingPolicy: { cancellationLeadMinutes: number; maxReschedules: number; depositRequired: boolean; depositPercentBps: number } };
type Slot = { startsAt: string; endsAt: string; providerId: string };
type Booking = { code: string; status: string; startsAt: string; endsAt: string; passPath: string; managePath: string; whatsappNotificationsQueued: boolean; depositDueMinor?: number; bookingPolicy?: Venue["bookingPolicy"]; packageInvoice?: { invoiceNumber: string; totalMinor: number; paidMinor: number; sessions: number; remainingSessions: number; paymentPreference: string } | null; manualPayment?: ManualPayment | null };

function dateInZone(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (key: string) => parts.find((value) => value.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function addDays(date: string, count: number): string { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + count); return value.toISOString().slice(0, 10); }
function dateLabel(value: string, timezone: string, locale: string): string { return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { timeZone: timezone, dateStyle: "full", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function BookingPortal({ slug }: { slug: string }) {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
const [providers, setProviders] = useState<Provider[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>([]);
  const [branchId, setBranchId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [providerId, setProviderId] = useState("any");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentPreference, setPaymentPreference] = useState<"cash_at_visit" | "electronic_requested">("cash_at_visit");
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [manageToken, setManageToken] = useState("");
  const locale = useLocale();
  const isEnglish = locale === "en";
  const copy = (isEnglish ? enMessages : arMessages).bookingPortal;

  useEffect(() => {
    void fetch(`/api/public/booking/${encodeURIComponent(slug)}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { venue?: Venue; branches?: Branch[]; services?: Service[]; providers?: Provider[]; businessHours?: BusinessHour[]; error?: string };
      if (!response.ok || !data.venue) throw new Error(data.error ?? copy.unavailable);
      setVenue(data.venue); setBranches(data.branches ?? []); setServices(data.services ?? []); setProviders(data.providers ?? []); setBusinessHours(data.businessHours ?? []);
      if (data.venue.bookingPolicy.depositRequired) setPaymentPreference("electronic_requested");
      if (data.branches?.[0]) setBranchId(data.branches[0].id);
      setDate(dateInZone(data.venue.timezone));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : copy.unavailable)).finally(() => setLoading(false));
  // The locale-derived copy is read for fallback text; locale changes remount the public flow safely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!venue || !branchId || !serviceId || !date || step !== 3) return;
    const controller = new AbortController();
    setSlotsLoading(true); setError(""); setSelectedSlot(null);
    const query = new URLSearchParams({ branchId, serviceId, date, providerId });
    void fetch(`/api/public/booking/${encodeURIComponent(slug)}/slots?${query}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { slots?: Slot[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.noSlots);
      setSlots(data.slots ?? []);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : copy.noSlots); }).finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    return () => controller.abort();
  // The locale-derived copy is read for fallback text; locale changes remount the public flow safely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue, branchId, serviceId, providerId, date, step, slug]);

  const terms = useMemo(() => venue ? getTerms(venue.vertical) : null, [venue]);
  const selectedService = services.find((service) => service.id === serviceId);
  const currency = selectedService?.currency ?? "EGP";
  const canContinue = step === 0 ? Boolean(branchId) : step === 1 ? Boolean(serviceId) : step === 2 ? Boolean(providerId) : step === 3 ? Boolean(selectedSlot) : Boolean(fullName.trim() && phone.trim());
  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venue || !selectedSlot) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, serviceId, providerId: selectedSlot.providerId, startsAt: selectedSlot.startsAt, fullName, phone, notes: notes || null, paymentPreference, whatsappConsent }) });
      const data = await response.json() as { booking?: Booking; error?: string };
      if (!response.ok || !data.booking) throw new Error(data.error ?? copy.unavailable);
      setBooking(data.booking);
      setManageToken(new URL(data.booking.managePath, window.location.origin).searchParams.get("token") ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.unavailable); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">{copy.loading}</main>;
  if (!venue || !terms) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-navy">{copy.unavailable}</h1><p className="mt-2 text-sm text-slate-600">{error || copy.contactVenue}</p></div></main>;
  if (booking) return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12"><DigitalPass slug={slug} code={booking.code} token={manageToken} googleReviewUrl={venue.googleReviewUrl} /></main>;

  const steps = [copy.steps[0], terms.service, terms.provider, copy.steps[3], copy.steps[4]];
  const branchOptions = branches.filter((branch) => services.some((service) => !service.branchId || service.branchId === branch.id));
  const serviceOptions = services.filter((service) => !service.branchId || service.branchId === branchId);
  const price = (minor: number) => new Intl.NumberFormat(isEnglish ? "en-GB" : "ar-EG", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  const minDate = venue ? dateInZone(venue.timezone) : "";
  const weekdayLabels = copy.weekdays;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12" dir={isEnglish ? "ltr" : "rtl"} lang={isEnglish ? "en-GB" : "ar-EG"}>
    <div className="mx-auto max-w-4xl">
      <header className="overflow-hidden rounded-3xl bg-navy px-6 py-8 text-white shadow-xl sm:px-10">
        <div className="flex items-center gap-4">{venue.logoUrl ? <img src={venue.logoUrl} alt={copy.venueLogo.replace("{name}", venue.name)} referrerPolicy="no-referrer" className="size-16 rounded-2xl bg-white object-contain p-2" /> : <div className="grid size-16 place-items-center rounded-2xl bg-teal text-xl font-bold">{venue.name.slice(0, 1)}</div>}<div><p className="text-sm text-teal-200">{copy.onlineBooking}</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">{venue.name}</h1></div></div>
        {venue.description && <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-200">{venue.description}</p>}
        {!!businessHours.length && <details className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4"><summary className="cursor-pointer text-sm font-bold text-white">{copy.weeklyHours}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{branches.map((branch) => { const rows = businessHours.filter((item) => item.branchId === branch.id || item.branchId === null); if (!rows.length) return null; return <section key={branch.id}><h2 className="text-sm font-semibold text-teal-200">{localizedBranchName(branch, locale)}</h2><div className="mt-2 space-y-1">{weekdayLabels.map((label, weekday) => { const ranges = providers.flatMap((provider) => { const matching = rows.filter((item) => item.weekday === weekday && (item.providerId === null || item.providerId === provider.id)).sort((a, b) => (Number(Boolean(b.branchId)) * 2 + Number(Boolean(b.providerId))) - (Number(Boolean(a.branchId)) * 2 + Number(Boolean(a.providerId)))); const schedule = matching[0]; return schedule ? [`${schedule.startsAt}–${schedule.endsAt}`] : []; }); const hours = Array.from(new Set(ranges)).join(" · ") || copy.closed; return <p key={weekday} className="flex justify-between gap-3 text-xs text-slate-200"><span>{label}</span><span>{hours}</span></p>; })}</div></section>; })}</div></details>}
        {venue.contactPhone && <a className="mt-4 inline-block text-sm text-teal-200 underline" href={`tel:${venue.contactPhone}`} dir="ltr">{venue.contactPhone}</a>}
      </header>
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <ol className="mb-8 grid grid-cols-5 gap-2" aria-label={copy.bookingSteps}>{steps.map((label, index) => <li key={label} className={`rounded-xl p-2 text-center text-xs sm:text-sm ${step === index ? "bg-teal text-white" : step > index ? "bg-teal/10 text-teal" : "bg-slate-100 text-slate-500"}`}><span className="mb-1 block font-bold">{index + 1}</span><span className="line-clamp-1">{label}</span></li>)}</ol>
        {step === 0 && <div><h2 className="text-xl font-bold text-navy">{copy.chooseBranch}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{branchOptions.map((branch) => <button key={branch.id} type="button" onClick={() => { setBranchId(branch.id); setServiceId(""); }} className={`rounded-2xl border p-4 text-right transition ${branchId === branch.id ? "border-teal bg-teal/5 ring-2 ring-teal/20" : "border-slate-200 hover:border-teal/50"}`}><span className="flex items-center gap-2 font-bold text-navy"><MapPin size={17} className="text-teal" />{localizedBranchName(branch, locale)}</span>{branch.address && <span className="mt-2 block text-sm text-slate-600">{branch.address}</span>}</button>)}</div></div>}
        {step === 1 && <div><h2 className="text-xl font-bold text-navy">{copy.choose} {terms.service}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{serviceOptions.map((service) => <motion.button key={service.id} type="button" whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={{ duration: 0.16 }} onClick={() => setServiceId(service.id)} className={`rounded-2xl border p-4 text-right transition ${serviceId === service.id ? "border-teal bg-teal/5 ring-2 ring-teal/20" : "border-slate-200 hover:border-teal/50"}`}><span className="font-bold text-navy">{service.name}</span><span className="mt-2 flex flex-wrap gap-x-3 text-sm text-slate-600"><span>{price(service.priceMinor)}</span><span className="inline-flex items-center gap-1"><Clock3 size={14} />{service.durationMinutes} {copy.serviceMinutes}</span>{service.kind !== "single" && <span>{service.sessionCount} {copy.sessions}</span>}</span>{service.description && <span className="mt-2 block text-sm text-slate-500">{service.description}</span>}</motion.button>)}</div></div>}
        {step === 2 && <div><h2 className="text-xl font-bold text-navy">{copy.choose} {terms.provider}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setProviderId("any")} className={`rounded-2xl border p-4 text-right ${providerId === "any" ? "border-teal bg-teal/5 ring-2 ring-teal/20" : "border-slate-200"}`}><span className="font-bold text-navy">{copy.anyProvider}</span><span className="mt-1 block text-sm text-slate-500">{copy.providerHelp}</span></button>{providers.map((provider) => <button key={provider.id} type="button" onClick={() => setProviderId(provider.id)} className={`rounded-2xl border p-4 text-right ${providerId === provider.id ? "border-teal bg-teal/5 ring-2 ring-teal/20" : "border-slate-200"}`}><span className="inline-flex items-center gap-2 font-bold text-navy"><UserRound size={17} className="text-teal" />{provider.fullName}</span></button>)}</div></div>}
        {step === 3 && <div><h2 className="text-xl font-bold text-navy">{copy.dateTime}</h2><label className="mt-4 block max-w-xs text-sm font-semibold text-navy">{copy.date}<input type="date" lang={isEnglish ? "en-GB" : "ar-EG"} dir={isEnglish ? "ltr" : "rtl"} value={date} min={minDate} max={addDays(minDate, 90)} onChange={(event) => { setDate(event.target.value); setSelectedSlot(null); }} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>{slotsLoading ? <p className="mt-6 text-sm text-slate-500">{copy.searching}</p> : slots.length ? <div className="mt-5"><p className="mb-3 text-sm text-slate-600">{copy.availableInTimezone}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{slots.map((slot) => { const selected = selectedSlot?.startsAt === slot.startsAt; const time = new Intl.DateTimeFormat(isEnglish ? "en-GB" : "ar-EG", { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(slot.startsAt)); const provider = providers.find((item) => item.id === slot.providerId); return <button type="button" key={`${slot.startsAt}-${slot.providerId}`} onClick={() => setSelectedSlot(slot)} className={`rounded-xl border px-3 py-3 text-sm ${selected ? "border-teal bg-teal text-white" : "border-slate-200 text-navy hover:border-teal"}`}><span className="block font-bold">{time}</span>{provider && providerId === "any" && <span className="mt-1 block text-xs opacity-80">{provider.fullName}</span>}</button>; })}</div></div> : <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{copy.noSlots}</p>}</div>}
        {step === 4 && <form id="booking-form" onSubmit={submitBooking} className="space-y-4"><h2 className="text-xl font-bold text-navy">{copy.bookingDetails}</h2>{selectedService && selectedSlot && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p className="font-semibold text-navy">{selectedService.name} · {dateLabel(selectedSlot.startsAt, venue.timezone, locale)}</p><p className="mt-1">{branches.find((item) => item.id === branchId)?.name} · {price(selectedService.priceMinor)}</p></div>}{venue.bookingPolicy.depositRequired && selectedService && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">{copy.depositPolicy}</p><p className="mt-1">{copy.amountDue}: {price(Math.ceil(selectedService.priceMinor * venue.bookingPolicy.depositPercentBps / 10_000))} ({venue.bookingPolicy.depositPercentBps / 100}% {copy.invoiceTotal}). {copy.transferReviewed}</p></div>}<label className="block text-sm font-semibold text-navy">{copy.fullName}<input required minLength={5} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" autoComplete="name" /></label><label className="block text-sm font-semibold text-navy">{copy.whatsapp}<input required type="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" dir="ltr" placeholder="+20 10 0000 0000" autoComplete="tel" /></label><label className="block text-sm font-semibold text-navy">{copy.optionalNotes}<textarea maxLength={1200} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label><fieldset><legend className="text-sm font-semibold text-navy">{copy.paymentMethod}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{!venue.bookingPolicy.depositRequired && <button type="button" onClick={() => setPaymentPreference("cash_at_visit")} className={`rounded-xl border p-3 text-right text-sm ${paymentPreference === "cash_at_visit" ? "border-teal bg-teal/5" : "border-slate-200"}`}><WalletCards size={16} className="mb-1 text-teal" />{copy.cashAtVisit}</button>}{venue.acceptElectronicRequest && <button type="button" onClick={() => setPaymentPreference("electronic_requested")} className={`rounded-xl border p-3 text-right text-sm ${paymentPreference === "electronic_requested" ? "border-teal bg-teal/5" : "border-slate-200"}`}><WalletCards size={16} className="mb-1 text-teal" />{venue.bookingPolicy.depositRequired ? copy.depositRequest : copy.electronicRequest}</button>}</div></fieldset>{paymentPreference === "electronic_requested" && venue.manualPayment && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">{copy.transferInstructions}</p>{venue.bookingPolicy.depositRequired && selectedService && <p>{copy.deposit}: <strong>{price(Math.ceil(selectedService.priceMinor * venue.bookingPolicy.depositPercentBps / 10_000))}</strong>. {copy.notRecorded}</p>}{venue.manualPayment.mobileWalletNumber && <p>{copy.wallet} {venue.manualPayment.mobileWalletLabel || copy.electronic}: <bdi dir="ltr" className="font-mono font-semibold">{venue.manualPayment.mobileWalletNumber}</bdi></p>}{venue.manualPayment.instapayLink && <a href={venue.manualPayment.instapayLink} target="_blank" rel="noreferrer" className="inline-block font-semibold text-teal underline">{copy.openInstapay}</a>}{venue.manualPayment.instapayQrUrl && <a href={venue.manualPayment.instapayQrUrl} target="_blank" rel="noreferrer"><img src={venue.manualPayment.instapayQrUrl} alt={copy.instapayQr} referrerPolicy="no-referrer" className="mt-2 max-h-56 rounded-lg border border-amber-200 bg-white object-contain p-2" /></a>}{venue.manualPayment.paymentInstructions && <p className="whitespace-pre-wrap">{venue.manualPayment.paymentInstructions}</p>}<p className="border-t border-amber-200 pt-2 text-xs">{copy.paymentRequestOnly}</p></div>}<label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><input type="checkbox" checked={whatsappConsent} onChange={(event) => setWhatsappConsent(event.target.checked)} className="mt-1 size-4 accent-teal" /><span>{copy.whatsappConsent}</span></label><p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={15} className="text-teal" />{copy.privacy}</p></form>}
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">{step > 0 ? <Button type="button" variant="outline" onClick={() => { setError(""); setStep((value) => value - 1); }}><ArrowRight size={16} />{copy.previous}</Button> : <span />}{step < 4 ? <Button type="button" disabled={!canContinue} onClick={() => { setError(""); setStep((value) => value + 1); }}><span>{copy.next}</span><ArrowLeft size={16} /></Button> : <Button type="submit" form="booking-form" disabled={submitting || !canContinue}><Check size={17} />{submitting ? copy.confirming : copy.confirm}</Button>}</div>
      </section>
      <footer className="mt-5 text-center text-xs text-slate-500">{copy.powered} {PRODUCT_NAME} · {venue.timezone}</footer>
    </div>
  </main>;
}
