# SEO وSocial Preview — Qutoof Business

الصفحات العامة القابلة للفهرسة هي `/` و`/solutions` و`/pricing`. لكل صفحة عنوان ووصف وكلمات مفتاحية ثنائية اللغة، canonical مطلق، Open Graph، Twitter Card، وبيانات منظمة JSON-LD. لا تدخل صفحات لوحة التشغيل أو الإدارة أو API إلى sitemap. يعمل `robots.txt` و`sitemap.xml` كمسارين Edge ديناميكيين حتى يطابق النطاق قيمة runtime الفعلية.

يُبنى الأصل العام من `NEXT_PUBLIC_BASE_URL` إذا كان عنوان HTTPS صالحاً، مع fallback المعروف للمشروع `https://qutoof-crm-2.pages.dev`. يجب ضبط `NEXT_PUBLIC_BASE_URL` في Cloudflare Pages على النطاق الإنتاجي النهائي قبل الإطلاق إذا تغيّر النطاق.

صورة المشاركة الاجتماعية الموحدة هي `/brand/qutoof-business-social-v2.png` بحجم 1200×630، وتحمل علامة Qutoof Business الحالية. استخدام مسار إصدار جديد عند تحديث الصورة يساعد منصات المشاركة على جلب الأصل الجديد بدلاً من نسخة مخزنة مؤقتاً.

لإثبات الملكية في Google Search Console، أضف قيمة meta tag التي يقدمها Google إلى متغير Pages runtime باسم `GOOGLE_SITE_VERIFICATION`. ستظهر القيمة تلقائياً في metadata دون تعديل ملفات الواجهة أو إدخالها في المستودع. بعد النشر، أرسل `https://<النطاق-الإنتاجي>/sitemap.xml` في Search Console.

المسارات التي يجب فحصها بعد النشر هي:

- `https://<النطاق-الإنتاجي>/`
- `https://<النطاق-الإنتاجي>/solutions`
- `https://<النطاق-الإنتاجي>/pricing`
- `https://<النطاق-الإنتاجي>/robots.txt`
- `https://<النطاق-الإنتاجي>/sitemap.xml`

يجب أن يعيد كل مسار عام HTML يحمل محتوى الصفحة وmetadata من الاستجابة الأولى، لا بعد تنفيذ JavaScript فقط. أما خطط الأسعار فتظل حية من `/api/public/plans` ولا تُحقن كقيم ثابتة في JSON-LD.
