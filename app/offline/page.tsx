import Link from "next/link";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

export default function OfflinePage() {
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6" dir="rtl"><section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-navy font-bold text-white">ق</span><strong className="mt-4 block text-sm font-bold text-navy" dir="ltr">{PRODUCT_NAME}</strong><small className="mt-1 block text-[10px] text-slate-500">{PRODUCT_TAGLINE}</small><h1 className="mt-5 text-2xl font-bold text-navy">أنت غير متصل بالإنترنت</h1><p className="mt-3 text-sm leading-7 text-slate-600">لا تُخزّن {PRODUCT_NAME} بيانات الحجز أو لوحة العمل على الجهاز. اتصل بالإنترنت ثم أعد تحميل الصفحة لمتابعة الحجز بأمان.</p><Link href="/" className="mt-5 inline-block rounded-xl bg-teal px-5 py-3 text-sm font-semibold text-white">إعادة المحاولة</Link></section></main>;
}
