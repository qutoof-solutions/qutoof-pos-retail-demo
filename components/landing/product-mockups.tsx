"use client";

import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Dumbbell,
  Package,
  ReceiptText,
  ShoppingCart,
  Stethoscope,
  UtensilsCrossed,
} from "lucide-react";

export type LandingLanguage = "ar" | "en";
export type IndustryKind = "retail" | "wholesale" | "showroom" | "clinic" | "gym" | "restaurant" | "services";

const labels = {
  ar: {
    demo: "عرض توضيحي · بيانات تجريبية",
    workspace: "Qutoof Business",
    overview: "نظرة عامة",
    today: "اليوم",
    bookings: "الحجوزات",
    sales: "المبيعات",
    inventory: "المخزون",
    schedule: "جدول اليوم",
    demoAppointment: "موعد تجريبي",
    confirmed: "مؤكد",
    inProgress: "قيد التنفيذ",
    dashboard: "لوحة التشغيل",
    ticket: "تذكرة موعد",
    sampleBooking: "حجز تجريبي",
    branch: "الفرع الرئيسي",
    qrHint: "امسح الرمز لتسجيل الوصول",
    testCode: "QUTOOF-DEMO-01",
    posTitle: "نقطة البيع",
    invoice: "فاتورة تجريبية #1048",
    product: "منتج تجريبي",
    qty: "الكمية",
    total: "الإجمالي",
    pay: "تسجيل عملية الدفع",
    stockTitle: "حركة المخزون",
    warehouse: "المستودع الرئيسي",
    available: "متاح",
    reserved: "محجوز",
    itemA: "صنف تجريبي A",
    itemB: "صنف تجريبي B",
    patientTitle: "ملف تجريبي",
    visit: "زيارة تجريبية",
    prescription: "روشتة تجريبية",
    privateRecord: "بيانات توضيحية فقط",
    gymTitle: "عضوية تجريبية",
    memberLabel: "مشترك تجريبي",
    membershipLabel: "اشتراك شهري تجريبي",
    validUntil: "صالحة حتى 30/11/2026",
    checkIn: "تسجيل وصول تجريبي",
    restaurantPosTitle: "نقطة بيع المطعم",
    orderTitle: "طلبات المطبخ",
    table: "طاولة",
    sampleOrder: "طلب تجريبي",
    preparing: "قيد التحضير",
    ready: "جاهز للتقديم",
    zReport: "تقرير إقفال الوردية",
    shiftClosed: "وردية تجريبية · مغلقة",
    cash: "نقدي",
    electronic: "إلكتروني",
    net: "صافي الوردية",
    week: "ملخص الأسبوع",
  },
  en: {
    demo: "Product preview · Synthetic data",
    workspace: "Qutoof Business",
    overview: "Overview",
    today: "Today",
    bookings: "Bookings",
    sales: "Sales",
    inventory: "Inventory",
    schedule: "Today's schedule",
    demoAppointment: "Sample appointment",
    confirmed: "Confirmed",
    inProgress: "In progress",
    dashboard: "Operations dashboard",
    ticket: "Appointment ticket",
    sampleBooking: "Sample booking",
    branch: "Main branch",
    qrHint: "Scan to check in",
    testCode: "QUTOOF-DEMO-01",
    posTitle: "Point of sale",
    invoice: "Sample invoice #1048",
    product: "Sample product",
    qty: "Qty",
    total: "Total",
    pay: "Record payment",
    stockTitle: "Inventory movement",
    warehouse: "Main warehouse",
    available: "Available",
    reserved: "Reserved",
    itemA: "Sample item A",
    itemB: "Sample item B",
    patientTitle: "Sample record",
    visit: "Sample visit",
    prescription: "Sample prescription",
    privateRecord: "Illustrative data only",
    gymTitle: "Sample membership",
    memberLabel: "Sample member",
    membershipLabel: "Sample monthly plan",
    validUntil: "Valid through 30 Nov 2026",
    checkIn: "Sample check-in",
    restaurantPosTitle: "Restaurant point of sale",
    orderTitle: "Kitchen orders",
    table: "Table",
    sampleOrder: "Sample order",
    preparing: "Preparing",
    ready: "Ready to serve",
    zReport: "Shift close report",
    shiftClosed: "Sample shift · closed",
    cash: "Cash",
    electronic: "Electronic",
    net: "Shift net",
    week: "Week summary",
  },
} satisfies Record<LandingLanguage, Record<string, string>>;

export function HeroMockups({ language }: { language: LandingLanguage }) {
  const t = labels[language];
  const isAr = language === "ar";

  return (
    <div className="relative mx-auto w-full max-w-[690px] pb-10 pt-4 sm:pt-8">
      <div aria-hidden="true" className="landing-orbit landing-orbit-one" />
      <div aria-hidden="true" className="landing-orbit landing-orbit-two" />
      <div className="landing-mockup-shell relative overflow-hidden rounded-[1.6rem] border border-slate-300/90 bg-[#0a1825]/95 p-2 shadow-[0_35px_100px_-30px_rgba(15,23,42,.48)] ring-1 ring-slate-900/10 backdrop-blur-xl dark:border-white/20 dark:ring-white/10 sm:rounded-[2rem] sm:p-3">
        <div className="landing-mockup-header flex items-center justify-between rounded-t-[1.1rem] border-b border-white/10 bg-white/[0.035] px-3 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-rose-400/80" />
            <span className="size-2.5 rounded-full bg-amber-300/80" />
            <span className="size-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <span className="text-[10px] font-medium text-slate-400 sm:text-xs">{t.workspace} · {t.dashboard}</span>
          <span className="size-6 rounded-lg bg-teal-300/15" />
        </div>
        <div className="grid min-h-[300px] grid-cols-[54px_1fr] sm:min-h-[360px] sm:grid-cols-[76px_1fr]" dir={isAr ? "rtl" : "ltr"}>
          <aside className="landing-mockup-sidebar flex flex-col items-center gap-4 border-e border-white/10 bg-[#0d1d2c] px-2 py-4 sm:gap-5 sm:py-6">
            <span className="grid size-8 place-items-center rounded-xl bg-teal-300/15 text-teal-200 sm:size-10"><Activity size={19} /></span>
            <span className="grid size-7 place-items-center rounded-lg bg-white/[0.045] text-slate-400"><CalendarDays size={15} /></span>
            <span className="grid size-7 place-items-center rounded-lg bg-white/[0.045] text-slate-400"><ShoppingCart size={15} /></span>
            <span className="grid size-7 place-items-center rounded-lg bg-white/[0.045] text-slate-400"><Package size={15} /></span>
            <span className="mt-auto grid size-7 place-items-center rounded-full bg-slate-700 text-[9px] font-bold text-slate-200">Q</span>
          </aside>
          <section className="min-w-0 p-3 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-[10px] text-slate-400 sm:text-xs">{t.overview}</p><h2 className="mt-1 text-sm font-bold text-white sm:text-lg">{t.today} · {t.schedule}</h2></div>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[9px] text-emerald-200 sm:px-3 sm:text-[10px]">{t.demo}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-3">
              <Metric label={t.bookings} value="24" tone="teal" />
              <Metric label={t.sales} value={isAr ? "12.4k" : "12.4k"} tone="blue" />
              <Metric label={t.inventory} value="86%" tone="gold" />
            </div>
            <div className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-[1.15fr_.85fr]">
              <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
                <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-200 sm:text-xs">{t.week}</span><span className="text-[9px] text-teal-200">+12%</span></div>
                <div className="mt-4 flex h-16 items-end justify-between gap-1.5 sm:h-20 sm:gap-2">
                  {[36, 55, 43, 78, 60, 90, 68].map((height, index) => <span key={index} className="min-w-1 flex-1 rounded-t-md bg-gradient-to-t from-teal-500/50 to-cyan-300" style={{ height: `${height}%`, opacity: index === 5 ? 1 : 0.48 + index * 0.05 }} />)}
                </div>
              </div>
              <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
                <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-200 sm:text-xs">{t.schedule}</span><CalendarDays size={13} className="text-teal-200" /></div>
                <div className="mt-3 space-y-2">
                  <ScheduleRow time="09:30" label={t.demoAppointment} status={t.confirmed} />
                  <ScheduleRow time="10:15" label={t.demoAppointment} status={t.inProgress} />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div className="landing-ticket absolute -bottom-1 end-2 z-10 w-[142px] rounded-[1.7rem] border border-slate-300 bg-[#101e2b] p-1.5 shadow-[0_22px_55px_-18px_rgba(0,0,0,.55)] ring-1 ring-slate-900/10 dark:border-white/20 dark:ring-white/10 sm:end-8 sm:w-[178px] sm:rounded-[2.1rem] sm:p-2">
        <div className="overflow-hidden rounded-[1.35rem] bg-[#f7fbfc] px-3 pb-3 pt-2 text-center text-slate-800 sm:rounded-[1.7rem] sm:px-4 sm:pb-4">
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-slate-300" />
          <p className="text-[8px] font-semibold text-teal-700 sm:text-[9px]">{t.ticket}</p>
          <h3 className="mt-1 text-[10px] font-bold sm:text-xs">{t.sampleBooking}</h3>
          <p className="mt-1 text-[8px] text-slate-500 sm:text-[9px]">{t.branch} · 09:30</p>
          <div className="mx-auto mt-2 grid size-[84px] place-items-center rounded-xl bg-white p-2 shadow-sm sm:mt-3 sm:size-[112px] sm:p-2.5">
            <QRCodeSVG value={t.testCode} size={92} level="M" includeMargin={false} className="size-full" aria-label={language === "ar" ? "رمز QR تجريبي" : "Sample QR code"} />
          </div>
          <p className="mt-2 text-[7px] leading-4 text-slate-500 sm:text-[8px]">{t.qrHint}</p>
        </div>
      </div>
      <span className="absolute -start-1 top-10 hidden items-center gap-2 rounded-full border border-white/10 bg-[#102535]/90 px-3 py-2 text-[10px] text-slate-200 shadow-lg backdrop-blur sm:flex"><CircleDollarSign size={14} className="text-teal-200" />{t.demo}</span>
    </div>
  );
}

export function IndustryMockup({ kind, language }: { kind: IndustryKind; language: LandingLanguage }) {
  const t = labels[language];
  const isAr = language === "ar";
  const title = kind === "retail" ? t.posTitle : kind === "wholesale" ? t.stockTitle : kind === "clinic" ? t.patientTitle : kind === "gym" || kind === "services" ? t.gymTitle : kind === "showroom" ? t.stockTitle : t.restaurantPosTitle;
  const Icon = kind === "retail" ? ReceiptText : kind === "wholesale" || kind === "showroom" ? Package : kind === "clinic" ? Stethoscope : kind === "gym" || kind === "services" ? Dumbbell : UtensilsCrossed;

  return (
    <div className="relative mx-auto w-full max-w-[590px]">
      <div className="absolute -inset-5 rounded-[2rem] bg-teal-300/10 blur-3xl" />
      <div className="landing-mockup-shell relative overflow-hidden rounded-[1.5rem] border border-slate-300/90 bg-[#0a1724] p-2 shadow-[0_30px_80px_-28px_rgba(15,23,42,.48)] ring-1 ring-slate-900/10 dark:border-white/20 dark:ring-white/10 sm:rounded-[1.8rem] sm:p-3">
        <div className="landing-mockup-header flex items-center justify-between border-b border-white/10 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-teal-300/15 text-teal-100"><Icon size={15} /></span><span className="text-xs font-semibold text-slate-100">{title}</span></div>
          <span className="rounded-full border border-amber-200/20 bg-amber-200/10 px-2 py-1 text-[9px] text-amber-100">{t.demo}</span>
        </div>
        <div className="grid min-h-[245px] gap-3 p-3 sm:min-h-[285px] sm:grid-cols-[1fr_.72fr] sm:gap-4 sm:p-4" dir={isAr ? "rtl" : "ltr"}>
          <IndustryScreen kind={kind} language={language} />
          <aside className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
            <div><p className="text-[10px] text-slate-400">{t.overview}</p><div className="mt-2 flex items-center gap-2"><span className="grid size-8 place-items-center rounded-xl bg-teal-300/15 text-teal-100"><Activity size={16} /></span><strong className="text-sm text-white">{kind === "clinic" ? "08" : kind === "gym" || kind === "services" ? "32" : kind === "restaurant" ? "12" : kind === "wholesale" ? "86%" : "24"}</strong></div></div>
            <div className="my-3 h-px bg-white/10" />
            <div className="space-y-2">
              {[0, 1, 2].map((item) => <div key={item} className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${item === 0 ? "bg-teal-300" : "bg-slate-600"}`} /><span className="h-1.5 flex-1 rounded-full bg-white/10"><span className="block h-full rounded-full bg-teal-300/60" style={{ width: `${82 - item * 17}%` }} /></span></div>)}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-300/15 bg-emerald-300/[0.07] px-2.5 py-2"><span className="text-[9px] text-emerald-100">{t.confirmed}</span><Check size={13} className="text-emerald-200" /></div>
          </aside>
        </div>
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[9px] text-slate-400 sm:mx-4 sm:mb-3"><span>{t.branch}</span><span>{t.privateRecord}</span></div>
      </div>
    </div>
  );
}

function IndustryScreen({ kind, language }: { kind: IndustryKind; language: LandingLanguage }) {
  const t = labels[language];
  const isAr = language === "ar";
  if (kind === "retail") return <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-white">{t.invoice}</span><ShoppingCart size={14} className="text-teal-200" /></div>
    <div className="mt-4 space-y-2">{[0, 1, 2].map((row) => <div key={row} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2.5 py-2"><span className="text-[9px] text-slate-300">{t.product} {row + 1}</span><span className="text-[9px] text-slate-400">× {row + 1}</span><span className="text-[9px] font-semibold text-slate-200">{row === 0 ? "120" : row === 1 ? "80" : "45"} {isAr ? "ج.م" : "EGP"}</span></div>)}</div>
    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3"><span className="text-[10px] text-slate-400">{t.total}</span><strong className="text-sm text-white">245 {isAr ? "ج.م" : "EGP"}</strong></div>
    <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-300 px-3 py-2 text-[9px] font-bold text-[#06252b]"><CircleDollarSign size={13} />{t.pay}</button>
  </div>;
  if (kind === "wholesale" || kind === "showroom") return <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-white">{t.warehouse}</span><Package size={14} className="text-teal-200" /></div>
    <div className="mt-4 space-y-3">{[t.itemA, t.itemB].map((item, index) => <div key={item} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-2.5"><div className="flex items-center justify-between"><span className="text-[9px] text-slate-200">{item}</span><span className="text-[8px] text-slate-500">SKU-DEMO-0{index + 1}</span></div><div className="mt-2 flex items-center justify-between text-[8px] text-slate-400"><span>{t.available}: {index === 0 ? "128" : "54"}</span><span>{t.reserved}: {index === 0 ? "12" : "6"}</span></div><div className="mt-2 h-1 rounded-full bg-white/10"><span className="block h-full w-3/4 rounded-full bg-gradient-to-r from-teal-400 to-cyan-300" /></div></div>)}</div>
  </div>;
  if (kind === "clinic") return <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-white">{t.patientTitle}</span><Stethoscope size={14} className="text-teal-200" /></div>
    <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/[0.04] p-2.5"><span className="grid size-8 place-items-center rounded-full bg-sky-300/15 text-[9px] font-bold text-sky-100">DEMO</span><span><strong className="block text-[9px] text-slate-100">{t.visit}</strong><small className="mt-1 block text-[8px] text-slate-400">09:30 · {t.confirmed}</small></span></div>
    <div className="mt-3 rounded-lg border border-teal-200/15 bg-teal-300/[0.06] p-3"><div className="flex items-center gap-2 text-[9px] font-semibold text-teal-100"><ClipboardList size={13} />{t.prescription}</div><div className="mt-2 space-y-2"><span className="block h-1.5 w-4/5 rounded-full bg-white/15" /><span className="block h-1.5 w-3/5 rounded-full bg-white/10" /></div><p className="mt-2 text-[8px] text-slate-400">{t.privateRecord}</p></div>
  </div>;
  if (kind === "gym" || kind === "services") return <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-white">{t.gymTitle}</span><Dumbbell size={14} className="text-teal-200" /></div>
    <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.035] p-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-sky-300/15 text-[8px] font-bold text-sky-100">DEMO</span><span><strong className="block text-[9px] text-slate-100">{t.memberLabel}</strong><small className="mt-1 block text-[8px] text-slate-400">{t.membershipLabel}</small></span></div><p className="mt-3 text-[8px] text-teal-100">{t.validUntil}</p></div>
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-teal-200/15 bg-teal-300/[0.06] p-2.5"><div className="grid size-14 shrink-0 place-items-center rounded-md bg-white p-1"><QRCodeSVG value="QUTOOF-GYM-DEMO-01" size={50} level="M" includeMargin={false} className="size-full" aria-label={language === "ar" ? "رمز عضوية تجريبي" : "Sample membership QR"} /></div><span className="text-[8px] leading-5 text-slate-300">{t.checkIn}<br />{t.qrHint}</span></div>
  </div>;
  return <div className="landing-mockup-card rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:rounded-2xl sm:p-4">
    <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-white">{t.restaurantPosTitle}</span><UtensilsCrossed size={14} className="text-teal-200" /></div>
    <div className="mt-4 space-y-2">{[0, 1, 2].map((row) => <div key={row} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2.5 py-2"><span className="text-[9px] text-slate-300">{t.product} {row + 1}</span><span className="text-[9px] text-slate-400">× {row + 1}</span><span className="text-[9px] font-semibold text-slate-200">{row === 0 ? "180" : row === 1 ? "95" : "60"} {isAr ? "ج.م" : "EGP"}</span></div>)}</div>
    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3"><span className="text-[10px] text-slate-400">{t.total}</span><strong className="text-sm text-white">395 {isAr ? "ج.م" : "EGP"}</strong></div>
    <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-300 px-3 py-2 text-[9px] font-bold text-[#06252b]"><CircleDollarSign size={13} />{t.pay}</button>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "teal" | "blue" | "gold" }) {
  const tones = { teal: "text-teal-100 bg-teal-300/10", blue: "text-sky-100 bg-sky-300/10", gold: "text-amber-100 bg-amber-300/10" };
  return <div className={`min-w-0 rounded-lg px-2 py-2 sm:rounded-xl sm:px-3 sm:py-3 ${tones[tone]}`}><p className="truncate text-[8px] opacity-75 sm:text-[9px]">{label}</p><p className="mt-1 truncate text-xs font-bold sm:text-base">{value}</p></div>;
}

function ScheduleRow({ time, label, status }: { time: string; label: string; status: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-white/[0.035] px-2 py-1.5"><span className="text-[8px] font-semibold text-teal-100">{time}</span><span className="min-w-0 flex-1 truncate text-[8px] text-slate-300">{label}</span><span className="hidden rounded-full bg-emerald-300/10 px-1.5 py-0.5 text-[7px] text-emerald-100 sm:inline-flex">{status}</span></div>;
}
