# Qutoof Business — Engineering Architecture

> هذا المستند هو المرجع التشغيلي الرسمي للمطورين البشريين ووكلاء البرمجة. يجب تحديثه مع أي تغيير معماري، لا مع كل تعديل تنسيقي صغير.

## 1. حدود النظام

Qutoof Business تطبيق SaaS متعدد المستأجرين لإدارة نقاط البيع، المخزون، الفروع، الحجوزات، العيادات، الجيم، التوزيع، التقارير، الفوترة والتكاملات. التطبيق مبني على Next.js App Router ويُشغّل على Cloudflare Pages/Workers باستخدام Edge Runtime، مع Cloudflare D1 كقاعدة SQLite، KV للجلسات وبعض حالات الإبطال، وR2 للملفات.

القاعدة الأساسية: كل قرار متعلق بالمستخدم أو المستأجر أو الفرع يجب أن يمر عبر صلاحيات الخادم ونطاق المستأجر. واجهة العميل ليست مصدر ثقة، ولا يجوز وضع منطق أمني أو تسعيري نهائي في React.

## 2. خريطة المستودع

### `app/` — حدود Next.js ومداخل النظام

- `app/page.tsx`: الصفحة التسويقية الرئيسية والـHero والقطاعات المختصرة.
- `app/solutions/page.tsx`: صفحة الحلول والقطاعات والتجارب التفاعلية.
- `app/pricing/page.tsx`: صفحة الباقات والأسعار الحية.
- `app/layout.tsx`, `app/globals.css`, `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts`: الجذر، التصميم العام، PWA وSEO.
- `app/dashboard/`: صفحات لوحة التشغيل المحمية؛ كل صفحة تربط وحدة تشغيل واحدة مثل POS، المخزون، الجدولة، العملاء، التقارير أو WhatsApp.
- `app/super-admin/`: واجهة إدارة المنصة والباقات والطلبات والدعم والإعدادات الحساسة.
- `app/[slug]/`: الصفحة العامة للمنشأة، الحجز العام وmanifest الخاص بالمنشأة.
- `app/queue/[branchId]/`: شاشة الانتظار العامة.
- `app/login/`, `app/register/`, `app/offline/`: الدخول، التسجيل وصفحة عدم الاتصال.
- `app/api/auth/`: الدخول والتسجيل والاستعادة و2FA والجلسات.
- `app/api/public/`: عقود عامة لا تتطلب لوحة تشغيل؛ أهمها `/api/public/plans` للأسعار والباقات الحية، الحجز، التوفر، الدعم والإعدادات العامة.
- `app/api/ops/`: عمليات المستأجر/الفرع بعد التحقق من الجلسة والصلاحيات.
- `app/api/super-admin/`: عمليات إدارة المنصة بعد حارس super-admin.
- `app/api/internal/`: عمال ومهام داخلية مثل الفوترة وWhatsApp والـtelemetry؛ ليست واجهات عامة.
- `app/api/webhooks/`: نقاط استقبال Telegram وWhatsApp مع التحقق من التوقيع/السر.
- `app/404/` و`app/[...path]/`: حدود fallback العامة؛ تعتبر مداخل Next صالحة حتى إن لم تستوردها ملفات أخرى.

مسارات API وصفحات التشغيل الحساسة تعمل على Edge حيث تعلن route/page ذلك صراحة. لا تفترض توفر Node APIs أو filesystem محلي داخل route؛ استخدم Web APIs وBindings الخاصة بـCloudflare.

### `components/` — واجهة قابلة لإعادة الاستخدام

- `components/landing/`: الغلاف التسويقي، Hero المركزي، الحلول، الباقات، mockups، PWA، WhatsApp والـsector explorer.
- `components/brand/`: `BrandLogo` و`BrandMark`؛ لا تُنشئ شعاراً أو مسار asset جديداً خارج مصدر الهوية المركزي.
- `components/dashboard/`: هيكل لوحة التشغيل والتنقل والاستجابة للهاتف.
- `components/operations/`: وحدات التشغيل الكبيرة مثل POS، المخزون، العملاء، العيادات، الجداول، التوزيع، التقارير والاستيراد.
- `components/platform/`: لوحة super-admin وإدارة الخطط والطلبات والميزات والدعم.
- `components/public/`: الحجز العام والتذكرة الرقمية وPWA.
- `components/providers/`, `components/theme/`, `components/ui/`: مزود اللغة، الثيم، الانتقالات وعناصر UI الأساسية.
- `components/seo/`: JSON-LD والبيانات المنظمة للصفحات العامة.

### `lib/` — منطق المجال ومصادر الخادم

- `lib/db/`: عميل Drizzle لـD1 و`schema.ts` الذي يصف الجداول والعلاقات.
- `lib/server/`: الجلسات، الوصول للفروع، العزل، auth rate limiting، الاستعادة، super-admin والحجز العام.
- `lib/operations/`: حالات المجال الذرية مثل الدفع، المخزون، الجدولة، التذاكر، الفوترة، التقارير والتعارضات غير المتصلة.
- `lib/platform/`: كتالوج المنصة، الباقات، الخصومات، الميزات، الطلبات وTelegram.
- `lib/i18n/`: locale والكوكيز والرسائل الخادمية والكتالوجات المحلية.
- `lib/pos/`: التخزين والمزامنة غير المتصلين لنقطة البيع.
- `lib/whatsapp/`: إجراءات WhatsApp والأمان والروابط والتكاملات المستخدمة فعلياً.
- `lib/marketing-seo.ts`: مصدر metadata وcanonical وOpen Graph وTwitter وJSON-LD للصفحات التسويقية.
- `lib/brand.ts`: مصدر الهوية الوحيد، كما هو موضح أدناه.

### `messages/` و`public/`

- `messages/ar.json` و`messages/en.json`: القاموسان الوحيدان للنصوص الثنائية. يجب أن تتطابق leaf keys بينهما.
- `public/brand/`: أصول Qutoof Business للنهار والليل والـmark وOpen Graph.
- `public/icons/`: أيقونات PWA الجديدة فقط.
- `public/sw.js`: Service Worker للمسار غير المتصل ومزامنة POS، مع cache version واضح.
- `public/offline-fallback.html`: صفحة عدم الاتصال الثابتة.
- `public/manus-routes.json`: manifest تشغيلي لمسارات المشروع، وليس بديلاً عن Next routes.

### `tests/`, `drizzle/`, `scripts/`, `docs/`

- `tests/`: اختبارات العقود والوحدات والعزل والتزامن والواجهة وi18n. لا تُعتبر الملفات المستوردة منها مستخدمة إنتاجياً.
- `drizzle/schema.ts` و`drizzle/migrations/`: سجل تغييرات D1 المصرح بها. لا تُعدّل أو تنشئ migration في دفعة واجهة دون موافقة صريحة.
- `scripts/`: فحوص i18n والتكامل والمخزون والعزل وأدوات التطوير.
- `docs/`: قرارات الهندسة والتشغيل؛ هذا الملف هو المرجع العام، و`docs/seo.md` مرجع SEO.

### `services/` — orchestrators ذات دورة حياة تشغيلية

يحتوي هذا المجلد على خدمات تنسّق أكثر من عملية أو route، مثل `services/whatsapp.ts` الذي يستخدم جدولة reminders لإرسال تأكيدات وتذكيرات الحجز. لا يكفي حصر import-graph في `app/` و`components/` و`lib/` عند تدقيق dead code؛ يجب إدراج `services/` وأي worker entrypoint في التحليل.

## 3. مصادر الحقيقة الواحدة

### الهوية

كل أسماء ومسارات الهوية موجودة في `lib/brand.ts` عبر `BRAND_ASSETS` و`PRODUCT_NAME` و`PRODUCT_TAGLINE`. يجب أن تستخدم المكونات `BrandLogo` أو `BrandMark`، وتستخدم metadata وmanifest وPWA نفس الثوابت. يمنع إدخال مسارات `qutoof-logo` أو `qutoof-mark` القديمة أو نسخ PNG جديدة يدوياً.

### اللغة

النصوص الظاهرة للمستخدم توضع في `messages/ar.json` و`messages/en.json`. مكوّنات التسويق تستخدم namespace `landing`، وبيانات SEO تستخدم namespace `seo`. عند إضافة مفتاح، أضفه في القاموسين في commit واحد وشغّل `npm run check:i18n:strict`.

### التصميم والثيم

`app/globals.css` هو مصدر قواعد التسويق والـPremium Light System، وليس لكل صفحة ملف ألوان مستقل. `components/theme/theme-script.tsx` يطبّق الثيم واللغة قبل الرسم لتفادي الوميض. أي watermark يجب أن تستخدم mark الجديد، وأن تبقى خلف المحتوى بترتيب stacking واضح لا يخفي النص.

## 4. قواعد UI/UX

### Premium Light System

السطوح الفاتحة التجارية تستخدم خلفية solid واضحة، حدوداً مرئية، تبايناً كافياً للنص، وظلاً محدوداً. حالات التحميل والفشل والفراغ لها سطح وحدود ونص واضح؛ لا تُترك ككتلة بيضاء باهتة. يجب أن يعمل التصميم في RTL وLTR، وعلى الهاتف وسطح المكتب، مع الحفاظ على focus states وaria labels.

بطاقات الباقات تستخدم ارتفاعاً متناسقاً ومحاذاة CTA في الأسفل. الأسعار والخصائص تأتي من `/api/public/plans` وواجهة البيانات الحية؛ لا تضف fallback سعرياً ثابتاً في React. أما نافذة القطاعات فتستخدم dialog حقيقياً، زر إغلاق، Escape، إغلاق خارج السطح وشبكة responsive.

### Hero والمحتوى

الـHero التسويقي مركزي وهرمي: eyebrow، عنوان، وصف، شارات القطاعات، CTA، ثم معاينة المنتج. لا تعُد إلى layout جانبي غير متوازن أو فراغات جانبية مصطنعة. زر `+25` يفتح مستكشف القطاعات داخل الصفحة ولا ينقل المستخدم بلا سبب.

### ممنوعات العرض

يُمنع إخفاء المحتوى بإسناد `opacity: 0` إلى عناصر تنتظر `IntersectionObserver`. يجب أن يكون المحتوى مقروءاً عند فشل observer أو تعطيل JavaScript غير الضروري. لا تستخدم نصوصاً بيضاء على سطح فاتح أو ألوان placeholder منخفضة التباين. افحص computed styles في الوضع النهاري والليلي قبل التسليم.

## 5. قاعدة البيانات وواجهات API

`lib/db/schema.ts` هو تعريف Drizzle المنطقي لـCloudflare D1. `lib/db/client.ts` ينشئ Drizzle من binding `DB` في Cloudflare request context. الاستعلامات الحساسة يجب أن تتضمن `tenantId` وscope الفرع المناسب، وتستخدم batches والحراس الذرية عند تحديث أكثر من جدول.

المigrations في `drizzle/migrations/` سجل تاريخي لا يُعاد ترتيبه ولا يُحذف منه شيء. لا تشغّل `db:migrate:remote` ولا تضف migration جديدة إلا بعد موافقة معتمدة على نطاق قاعدة البيانات. دفعات التسويق وSEO والهوية لا تلمس schema أو migrations.

الباقات المنشورة تُقرأ حياً من `/api/public/plans`، ويجري إعدادها من super-admin. الـfrontend يعرض العقد الراجع من API ولا يقرر السعر أو الصلاحيات. واجهات `app/api/internal` وwebhooks تتطلب bindings/secrets وتُعامل كحدود خادم لا كـAPI عام.

## 6. سياسة dead code والنظافة

ملفات `app/**/page.tsx` و`route.ts` و`layout.tsx` وملفات manifest/robots/sitemap مداخل إطار العمل، لذلك لا يجوز حذفها فقط لأنها لا تظهر في import graph. أما components وlib فيجب أن يكون لها import إنتاجي أو عقد واضح موثق. الاختبار وحده لا يكفي لإبقاء منطق إنتاجي غير مستخدم.

في دفعة التنظيف الحالية حُذف مكوّن الدعم غير المستورد، وأُبقي ملف جدولة reminders بعد اكتشاف مرجعه الإنتاجي في `services/whatsapp.ts`، وحُذفت 23 قيمة ترجمة لم توجد لها مراجع إنتاجية بعد التدقيق. لم تُحذف مفاتيح تُقرأ عبر `raw` أو عبر كتالوجات ديناميكية. بعد أي حذف يجب تشغيل typecheck وlint وtest وi18n strict.

## 7. التحقق والنشر

الأمر الإلزامي قبل الدمج هو:

```bash
npm run verify
```

وهو يشغّل بالترتيب: `typecheck`، `lint`، `check:i18n:strict`، `npm test`، ثم `build`. يمكن تشغيل الأجزاء منفردة أثناء التطوير، لكن لا يعتبر PR جاهزاً دون نجاح `verify`. فحوص التكامل الاختيارية هي `test:integration` و`test:inventory` و`test:api` عندما يمس التغيير تلك الحدود.

النشر المعتاد إلى Cloudflare Pages يعتمد على `npm run build`، ثم مخرجات Cloudflare/Next الخاصة بالمشروع. يجب ضبط متغيرات النطاق العامة في بيئة Pages:

- `NEXT_PUBLIC_BASE_URL`: النطاق canonical الكامل بصيغة `https://...`، ويُستخدم للـcanonical وOpen Graph وsitemap.
- `GOOGLE_SITE_VERIFICATION`: قيمة Google Search Console عند تفعيل التحقق؛ لا تُحفظ في git ولا تُكتب داخل القواميس.

وتحتاج بيئة الإنتاج أيضاً إلى bindings وأسرار Cloudflare التي يقرأها `lib/db/client.ts` وطبقات الخادم، ومنها `DB` و`KV_BINDING` و`FILES` و`SESSION_SECRET` وأسرار webhooks/WhatsApp/Telegram والفوترة بحسب الميزات المنشورة. لا تطبع هذه القيم في logs أو PRs.

## 8. بروتوكول تغيير لوكلاء البرمجة

1. افحص `git status` والفرع وPR قبل التعديل.
2. اقرأ مصدر الحقيقة المسؤول: `lib/brand.ts` للهوية، `messages/*.json` للترجمة، `app/globals.css` للتصميم، و`lib/db/schema.ts`/migrations لقاعدة البيانات.
3. حدّد نطاق الملفات المسموح به، ولا توسّعه إلى D1 بلا موافقة.
4. أضف اختبار عقدي للتغيير، خصوصاً للـAPI وi18n وRTL/LTR والحالات الفارغة.
5. شغّل `npm run verify`، راجع `git diff --check`، وتأكد من عدم وجود ملفات dead جديدة.
6. حدّث الوثائق فقط بما يطابق الكود الفعلي، ثم ادفع commit واحداً واضح الغرض إلى PR المناسب.

إذا تعارض طلب جديد مع هذه القواعد، أوقف التنفيذ عند نقطة التعارض واذكر الملف أو العقد المتأثر بدلاً من إنشاء fallback أو مسار قديم جديد.
