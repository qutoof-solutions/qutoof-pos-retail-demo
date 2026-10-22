"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Grid2X2,
  PackageCheck,
  RefreshCw,
  ScanBarcode,
  Send,
  ShoppingCart,
  Stethoscope,
  Tags,
  UserRound,
  Warehouse,
  Wifi,
} from "lucide-react";
import { ScrollReveal } from "./scroll-reveal";

const posTabs = ["POS Checkout", "Finance & Treasury", "WhatsApp CRM"] as const;
type PosTab = (typeof posTabs)[number];
const systems = ["ERP & Smart POS", "Multi-Warehouse & Distribution", "Clinics, Gym & Smart Bookings"] as const;
type DemoSystem = (typeof systems)[number];

export function LiveUiMockups() {
  const t = useTranslations("landing.liveMockups");
  const [activeSystem, setActiveSystem] = useState<DemoSystem>(systems[0]);
  const [manual, setManual] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (manual) return;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        if (value >= 100) {
          setActiveSystem((current) => systems[(systems.indexOf(current) + 1) % systems.length]);
          return 0;
        }
        return value + 2;
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, [manual]);

  const selectSystem = (system: DemoSystem) => {
    setActiveSystem(system);
    setManual(true);
    setProgress(100);
  };

  return (
    <section className="relative px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24" aria-labelledby="live-ui-title">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal>
          <div className="mx-auto max-w-3xl text-center">
            <p className="landing-eyebrow">{t("eyebrow")}</p>
            <h2 id="live-ui-title" className="landing-section-title mt-3">{t("title")}</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">{t("description")}</p>
          </div>
        </ScrollReveal>
        <div lang="en" dir="ltr" translate="no" className="mx-auto mt-10 max-w-5xl">
          <div className="rounded-[1.5rem] border border-teal-500/20 bg-[#07111a] p-3 shadow-[0_24px_70px_-32px_rgba(20,184,166,.65)] sm:p-4">
            <div className="grid gap-2 md:grid-cols-3">
              {systems.map((system) => <button key={system} type="button" onClick={() => selectSystem(system)} className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[10px] font-semibold transition sm:text-xs ${activeSystem === system ? "border-teal-400/60 bg-teal-400/15 text-teal-100 shadow-lg shadow-teal-400/10" : "border-white/10 bg-[#0f1d2d] text-slate-400 hover:border-teal-400/40 hover:text-slate-100"}`}><span>{system}</span>{activeSystem === system && <span className="shrink-0 text-[9px] text-emerald-300">✓ Active</span>}</button>)}
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-300 transition-[width] duration-75" style={{ width: `${progress}%` }} /></div>
            <div className="mt-5">
              {activeSystem === systems[0] && <PosFlowCard />}
              {activeSystem === systems[1] && <WarehouseCard />}
              {activeSystem === systems[2] && <BookingsCard />}
            </div>
            <div className="mt-3 flex items-center justify-between text-[9px] text-slate-400"><span>{manual ? "Manual exploration active" : "Auto-playing demo"}</span><button type="button" onClick={() => { setManual((value) => !value); setProgress(0); }} className="font-semibold text-teal-200 hover:text-teal-100">{manual ? "Resume auto-play" : "Pause for exploration"}</button></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MockupFrame({ children, title, icon: Icon }: { children: React.ReactNode; title: string; icon: typeof ShoppingCart }) {
  return (
    <article lang="en" dir="ltr" translate="no" className="relative overflow-hidden rounded-[1.5rem] border border-teal-500/20 bg-[#07111a] p-3 text-left shadow-[0_24px_70px_-32px_rgba(20,184,166,.65)] transition hover:-translate-y-1 hover:border-teal-400/40 sm:p-4">
      <div className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-teal-400/10 blur-3xl" />
      <div className="relative flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-100"><span className="grid size-7 place-items-center rounded-lg bg-teal-400/15 text-teal-200"><Icon size={15} /></span>{title}</div>
        <span className="flex items-center gap-1 text-[9px] text-emerald-300"><Wifi size={11} /> Live</span>
      </div>
      <div className="relative pt-3">{children}</div>
    </article>
  );
}

function PosFlowCard() {
  const [active, setActive] = useState<PosTab>(posTabs[0]);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        if (value >= 100) {
          setActive((current) => posTabs[(posTabs.indexOf(current) + 1) % posTabs.length]);
          return 0;
        }
        return value + 2;
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, [paused]);

  const select = (tab: PosTab) => {
    setActive(tab);
    setPaused(true);
    setProgress(100);
  };

  return (
    <MockupFrame title="ERP & Smart POS" icon={ShoppingCart}>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0f1d2d] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-medium text-slate-200"><Grid2X2 size={13} className="shrink-0 text-teal-200" /><span className="truncate">{active}</span></div>
        <ChevronDown size={14} className="text-slate-400" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-[#0f1d2d] p-1">
        {posTabs.map((tab) => <button key={tab} type="button" onClick={() => select(tab)} className={`rounded-lg px-1.5 py-2 text-[9px] font-semibold transition ${active === tab ? "bg-teal-400 text-[#06151b] shadow-lg shadow-teal-400/20" : "text-slate-400 hover:text-slate-100"}`}>{active === tab && <Check size={10} className="mx-auto mb-0.5" />}{tab}</button>)}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-300 transition-[width] duration-75" style={{ width: `${progress}%` }} /></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-[#132337] p-3"><p className="text-[9px] text-slate-400">Sales growth</p><p className="mt-1 text-xl font-bold text-white">{78 + Math.round(progress * 0.16)}%</p><p className="mt-1 text-[9px] text-emerald-300">+12.4% today</p></div>
        <div className="rounded-xl border border-white/10 bg-[#132337] p-3"><p className="text-[9px] text-slate-400">Live invoice</p><p className="mt-1 text-xl font-bold text-white">EGP {active === "WhatsApp CRM" ? "1,245" : active === "Finance & Treasury" ? "8,420" : "3,680"}</p><p className="mt-1 text-[9px] text-slate-400">{active === "WhatsApp CRM" ? "Customer #1048" : "Updated now"}</p></div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-[10px] text-emerald-200"><span className="flex items-center gap-1.5"><ScanBarcode size={13} /> Barcode scan ready</span><Send size={13} /></div>
      <button type="button" onClick={() => setPaused((value) => !value)} className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-semibold text-slate-400 hover:text-teal-200"><RefreshCw size={11} />{paused ? "Resume auto-play" : "Pause for exploration"}</button>
    </MockupFrame>
  );
}

function WarehouseCard() {
  const [view, setView] = useState<"launcher" | "inventory">("launcher");
  const [unit, setUnit] = useState<"Carton" | "Piece">("Carton");
  const [tier, setTier] = useState("Wholesale");
  const [restocked, setRestocked] = useState(false);
  const [manual, setManual] = useState(false);
  const quantity = unit === "Carton" ? 24 : 240;

  useEffect(() => {
    if (manual) return;
    const timer = window.setInterval(() => {
      setView("inventory");
      setUnit((current) => (current === "Carton" ? "Piece" : "Carton"));
      setTier((current) => current === "Wholesale" ? "Semi-Wholesale" : current === "Semi-Wholesale" ? "Retail" : "Wholesale");
      setRestocked((current) => !current);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [manual]);

  const pauseForExploration = () => setManual(true);

  return (
    <MockupFrame title="Warehouse & Distribution" icon={Warehouse}>
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0f1d2d] px-3 py-2"><span className="flex items-center gap-2 text-[10px] font-semibold text-slate-200"><Boxes size={14} className="text-teal-200" />Inventory workspace</span><span className="text-[9px] text-slate-400">{view === "launcher" ? "Apps" : "Live log"}</span></div>
      {view === "launcher" ? <div className="mt-3 grid grid-cols-3 gap-2">{[[PackageCheck, "Stock"], [Tags, "Price tiers"], [BarChart3, "Reports"], [ScanBarcode, "Barcode"], [Warehouse, "Warehouses"], [ClipboardCheck, "Transfers"]].map(([Icon, label]) => <button key={label as string} type="button" onClick={() => { pauseForExploration(); setView("inventory"); }} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-[#132337] text-[9px] font-medium text-slate-300 transition hover:border-teal-400/50 hover:text-teal-200"><Icon size={16} className="text-teal-200" />{label as string}</button>)}</div> : <div className="mt-3 space-y-3">
        <div className="flex gap-1 rounded-xl bg-[#0f1d2d] p-1">{(["Carton", "Piece"] as const).map((item) => <button key={item} type="button" onClick={() => { pauseForExploration(); setUnit(item); }} className={`flex-1 rounded-lg py-1.5 text-[9px] font-semibold ${unit === item ? "bg-teal-400 text-[#06151b]" : "text-slate-400"}`}>{item}</button>)}<ArrowRight size={13} className="my-auto text-teal-200" /></div>
        <div className="flex gap-1">{["Wholesale", "Semi-Wholesale", "Retail"].map((item) => <button key={item} type="button" onClick={() => { pauseForExploration(); setTier(item); }} className={`flex-1 rounded-lg border px-1 py-1.5 text-[8px] ${tier === item ? "border-teal-400/50 bg-teal-400/15 text-teal-200" : "border-white/10 text-slate-400"}`}>{item}</button>)}</div>
        <div className="rounded-xl border border-white/10 bg-[#132337] p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-100">Premium coffee beans</span><span className="text-[9px] text-teal-200">{tier}</span></div><div className="mt-3 flex items-end justify-between"><span className="text-[9px] text-slate-400">Available quantity</span><strong className="text-xl text-white">{quantity} <small className="text-[9px] font-normal text-slate-400">{unit.toLowerCase()}s</small></strong></div></div>
        <button type="button" onClick={() => { pauseForExploration(); setRestocked((value) => !value); }} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[9px] font-semibold transition ${restocked ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200"}`}><span className="flex items-center gap-1.5">{restocked ? <Check size={13} /> : <AlertTriangle size={13} />}{restocked ? "Restocked" : "Low Stock / Expiry Alert"}</span><span>{restocked ? "✓" : "Review"}</span></button>
        <button type="button" onClick={() => { pauseForExploration(); setView("launcher"); }} className="text-left text-[9px] text-slate-400 hover:text-teal-200">← Back to app launcher</button>
      </div>}
    </MockupFrame>
  );
}

const queueCards = [
  { name: "Maya Hassan", detail: "EMR & InBody Attached", type: "Clinic" },
  { name: "Omar Saleh", detail: "Sessions: 11/12", type: "Gym" },
  { name: "Lina Adel", detail: "Booking #2048", type: "Appointment" },
];

function BookingsCard() {
  const [column, setColumn] = useState(1);
  const [paused, setPaused] = useState(false);
  const columns = ["Waiting", "In Session", "Completed ✓"];
  const current = queueCards[column % queueCards.length];

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setColumn((value) => (value + 1) % columns.length), 3000);
    return () => window.clearInterval(timer);
  }, [paused, columns.length]);

  return (
    <MockupFrame title="Clinics, Gym & Bookings" icon={Stethoscope}>
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0f1d2d] px-3 py-2"><span className="flex items-center gap-2 text-[10px] font-semibold text-slate-200"><ClipboardCheck size={14} className="text-teal-200" />Live queue board</span><button type="button" onClick={() => setPaused((value) => !value)} className="text-[9px] text-slate-400 hover:text-teal-200">{paused ? "Play" : "Pause"}</button></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">{columns.map((item, index) => <button key={item} type="button" onClick={() => { setColumn(index); setPaused(true); }} className={`rounded-lg border px-1 py-2 text-[8px] font-semibold transition ${column === index ? "border-teal-400/50 bg-teal-400/15 text-teal-200" : "border-white/10 text-slate-400"}`}>{item}<span className="mt-1 block text-[10px] text-white">{index === column ? 1 : 0}</span></button>)}</div>
      <div className="mt-3 rounded-xl border border-teal-400/20 bg-[#132337] p-3 transition-all"><div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold text-white">{current.name}</p><p className="mt-1 text-[9px] text-slate-400">{current.type} · {columns[column]}</p></div><span className="grid size-7 place-items-center rounded-full bg-teal-400/15 text-teal-200"><UserRound size={14} /></span></div><div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-300/10 px-2.5 py-2 text-[9px] text-emerald-200"><Check size={12} />{column === 0 ? "Pending" : column === 1 ? "Confirmed ✓" : "Completed ✓"}</div><p className="mt-2 text-[9px] text-slate-400">{current.detail}</p></div>
      <div className="mt-3 flex items-center justify-between text-[9px] text-slate-400"><span className="flex items-center gap-1.5"><CircleDollarSign size={12} className="text-teal-200" />Smart booking flow</span><span>{column + 1}/3 states</span></div>
    </MockupFrame>
  );
}
