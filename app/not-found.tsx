import Link from "next/link";
import arMessages from "@/messages/ar.json";
import "./globals.css";

export const dynamic = "force-static";

export default function NotFound() {
  const copy = arMessages.common;
  return <main className="grid min-h-screen place-items-center bg-canvas p-6"><section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><p className="text-sm font-semibold text-teal">404</p><h1 className="mt-3 text-2xl font-bold text-navy">{copy.notFoundTitle}</h1><p className="mt-3 text-sm leading-7 text-slate-600">{copy.notFoundDescription}</p><Link href="/" className="mt-5 inline-flex rounded-xl bg-teal px-5 py-3 text-sm font-semibold text-white">{copy.backToHome}</Link></section></main>;
}
