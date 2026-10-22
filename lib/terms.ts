export const VERTICALS = ["medical", "beauty", "sports", "consulting", "retail", "wholesale", "restaurant"] as const;
export type Vertical = (typeof VERTICALS)[number];

export type TermKey =
  | "provider" | "customer" | "appointment" | "service" | "record" | "package"
  | "prescription" | "diagnosis" | "medical_record" | "medicalRecord" | "branch" | "booking" | "session" | "subscription";

export const TERMS = {
  medical: {
    provider: "طبيب", customer: "مريض", appointment: "كشف", service: "خدمة طبية", record: "ملف طبي", package: "باقة علاجية",
    prescription: "روشتة / وصفة طبية", diagnosis: "تشخيص", medical_record: "ملف طبي", medicalRecord: "ملف طبي", branch: "عيادة", booking: "حجز كشف", session: "جلسة علاجية", subscription: "اشتراك علاجي",
  },
  beauty: {
    provider: "أخصائي", customer: "عميل", appointment: "جلسة", service: "خدمة تجميل", record: "ملف العميل", package: "باقة خدمات",
    prescription: "توصيات العناية", diagnosis: "تقييم الحالة", medical_record: "ملف العميل", medicalRecord: "ملف العميل", branch: "مركز", booking: "حجز جلسة", session: "جلسة", subscription: "اشتراك خدمات",
  },
  sports: {
    provider: "مدرب أو ملعب", customer: "مشترك", appointment: "حجز", service: "نشاط", record: "ملف المشترك", package: "اشتراك",
    prescription: "خطة تدريب", diagnosis: "تقييم اللياقة", medical_record: "ملف المشترك", medicalRecord: "ملف المشترك", branch: "ملعب أو نادٍ", booking: "حجز نشاط", session: "حصة", subscription: "اشتراك شهري",
  },
  consulting: {
    provider: "مستشار", customer: "موكل", appointment: "استشارة", service: "خدمة استشارية", record: "ملف الموكل", package: "باقة استشارية",
    prescription: "توصية مهنية", diagnosis: "تقييم الحالة", medical_record: "ملف الموكل", medicalRecord: "ملف الموكل", branch: "مكتب", booking: "حجز استشارة", session: "جلسة استشارة", subscription: "اتفاق خدمات",
  },
  retail: {
    provider: "موظف", customer: "عميل", appointment: "عملية بيع", service: "منتج", record: "ملف العميل", package: "باقة بيع",
    prescription: "ملاحظة بيع", diagnosis: "ملاحظة بيع", medical_record: "ملف العميل", medicalRecord: "ملف العميل", branch: "محل", booking: "فاتورة بيع", session: "عملية بيع", subscription: "اشتراك",
  },
  wholesale: {
    provider: "مسؤول المبيعات", customer: "عميل جملة", appointment: "طلب توريد", service: "صنف", record: "حساب العميل", package: "قائمة أسعار جملة",
    prescription: "ملاحظة توريد", diagnosis: "متابعة توريد", medical_record: "حساب العميل", medicalRecord: "حساب العميل", branch: "فرع أو مخزن", booking: "طلب شراء", session: "تسليم", subscription: "اتفاق توريد",
  },
  restaurant: {
    provider: "طاقم الخدمة", customer: "زائر", appointment: "طلب", service: "صنف قائمة", record: "ملف العميل", package: "وجبة أو عرض",
    prescription: "ملاحظة طلب", diagnosis: "ملاحظة طلب", medical_record: "ملف العميل", medicalRecord: "ملف العميل", branch: "مطعم", booking: "طلب", session: "طلب", subscription: "اشتراك",
  },
} as const satisfies Record<Vertical, Record<TermKey, string>>;

export function getTerms(vertical: Vertical): (typeof TERMS)[Vertical] {
  return TERMS[vertical];
}

export function getTerm(vertical: Vertical, key: TermKey): string {
  return TERMS[vertical][key];
}

export function getAppointmentTermPlural(vertical: Vertical): string {
  switch (vertical) {
    case "medical": return "الكشوف";
    case "beauty": return "الجلسات";
    case "sports": return "الحجوزات";
    case "retail": return "المبيعات";
    case "wholesale": return "طلبات التوريد";
    case "restaurant": return "الطلبات";
    default: return "الاستشارات";
  }
}

/** Applies tenant-specific domain wording to reusable Arabic message copy. */
export function applyTenantTerms(text: string, vertical: Vertical): string {
  const terms = TERMS[vertical];
  return text
    .replace(/\{\{\s*provider\s*\}\}/g, terms.provider)
    .replace(/\{\{\s*customer\s*\}\}/g, terms.customer)
    .replace(/\{\{\s*appointment\s*\}\}/g, terms.appointment)
    .replace(/\{\{\s*service\s*\}\}/g, terms.service)
    .replace(/\{\{\s*record\s*\}\}/g, terms.record)
    .replace(/\{\{\s*package\s*\}\}/g, terms.package)
    .replace(/(?:طبيب|أخصائي|مدرب|مستشار|موظف|مسؤول المبيعات|طاقم الخدمة)/gu, terms.provider)
    .replace(/(?:مريض|عميل جملة|عميل|مشترك|موكل|زائر)/gu, terms.customer)
    .replace(/(?:كشف|جلسة|استشارة|حجز|موعد|طلب توريد|عملية بيع|طلب)/gu, terms.appointment);
}
