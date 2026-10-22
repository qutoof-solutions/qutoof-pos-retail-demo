export type ChatLanguage = "ar" | "en";
export type ChatReply = { answer: string; suggestedPlan: string | null; canEscalate: boolean; quickReplies: string[] };

const catalog = {
  ar: {
    greeting: "أهلاً بك في قطوف. أقدر أساعدك في اختيار الباقة، معرفة المزايا، أو تصعيد طلب لفريق الدعم.",
    pricing: "الباقات تختلف حسب نوع النشاط والمزايا المطلوبة. ابدأ بتحديد نشاطك، وسأرشح لك المسار الأقرب.",
    trial: "يمكنك بدء الفترة التجريبية من زر ابدأ الآن، ثم اختيار الباقة المناسبة من صفحة التسجيل.",
    support: "أقدر أفتح لك تذكرة دعم مع موعد مفضل. اضغط «فتح تذكرة» وأرسل بيانات التواصل والتفاصيل.",
    medical: "لعيادة أو مركز طبي، الترشيح الأقرب عادة باقة العيادات/المراكز التي تدعم المواعيد والملفات السريرية والتمريض.",
    retail: "للمحل أو التجزئة، الترشيح الأقرب باقة نقاط البيع والمخزون والفواتير.",
    restaurant: "للمطاعم والكافيهات، ركّز على باقة نقاط البيع والمخزون والفواتير السريعة.",
    wholesale: "للجملة والتوزيع، الترشيح الأقرب باقة المخازن المتعددة وحركة التحويلات والمشتريات.",
    gym: "للجيم والاشتراكات، تتوفر إدارة العضويات والاستحقاقات وبوابة QR بحسب الباقة والمزايا المفعلة.",
    fallback: "أستطيع الإجابة عن الباقات، نقاط البيع، المخزون، المواعيد، الملفات الطبية، والاشتراكات. إذا لم تجد إجابتك، افتح تذكرة وسيتابعها فريق الدعم.",
    replies: ["ما الباقة المناسبة لنشاطي؟", "كيف تبدأ الفترة التجريبية؟", "أريد فتح تذكرة دعم"],
  },
  en: {
    greeting: "Welcome to Qutoof. I can help you choose a plan, explain features, or escalate a request to support.",
    pricing: "Plans vary by industry and required features. Tell me your business type and I will suggest the closest path.",
    trial: "Start your trial from the Get started button, then choose the right plan during registration.",
    support: "I can open a support ticket with a preferred appointment time. Choose “Open a ticket” and share your contact details.",
    medical: "For a clinic or medical center, the closest fit usually includes appointments, clinical records, and nursing workflows.",
    retail: "For retail, the closest fit focuses on POS, inventory, and invoices.",
    restaurant: "For restaurants and cafés, focus on fast POS, inventory, and invoice workflows.",
    wholesale: "For wholesale and distribution, the closest fit includes multi-warehouse inventory, transfers, and purchasing.",
    gym: "For gyms and subscriptions, memberships, entitlements, and QR Gate are available depending on the selected plan.",
    fallback: "I can answer questions about plans, POS, inventory, appointments, clinical records, and subscriptions. If I miss your question, open a ticket and our support team will follow up.",
    replies: ["Which plan fits my business?", "How does the trial work?", "Open a support ticket"],
  },
} as const;

function includesAny(message: string, values: string[]) { return values.some((value) => message.toLocaleLowerCase().includes(value)); }
export function replyToMessage(message: string, language: ChatLanguage): ChatReply {
  const t = catalog[language]; const text = message.trim().toLocaleLowerCase();
  if (!text) return { answer: t.greeting, suggestedPlan: null, canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["سعر", "باقة", "باقات", "اشتراك", "plan", "price"] : ["plan", "price", "pricing", "package"])) return { answer: t.pricing, suggestedPlan: null, canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["تجريب", "تجربة", "ابدأ"] : ["trial", "start", "demo"])) return { answer: t.trial, suggestedPlan: null, canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["عيادة", "مستشفى", "طبي", "تمريض"] : ["clinic", "hospital", "medical", "nursing"])) return { answer: t.medical, suggestedPlan: "medical", canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["محل", "تجزئة", "كاشير", "بيع"] : ["retail", "shop", "cashier", "store"])) return { answer: t.retail, suggestedPlan: "retail", canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["مطعم", "كافيه", "مقهى"] : ["restaurant", "cafe", "coffee"])) return { answer: t.restaurant, suggestedPlan: "restaurant", canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["جملة", "توزيع", "مخزن", "مستودع"] : ["wholesale", "distribution", "warehouse", "inventory"])) return { answer: t.wholesale, suggestedPlan: "wholesale", canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["جيم", "اشتراكات", "عضوية", "تذاكر"] : ["gym", "membership", "subscription", "tickets"])) return { answer: t.gym, suggestedPlan: "gym", canEscalate: false, quickReplies: [...t.replies] };
  if (includesAny(text, language === "ar" ? ["دعم", "مشكلة", "تذكرة", "موظف"] : ["support", "problem", "ticket", "agent"])) return { answer: t.support, suggestedPlan: null, canEscalate: true, quickReplies: [...t.replies] };
  return { answer: t.fallback, suggestedPlan: null, canEscalate: true, quickReplies: [...t.replies] };
}
