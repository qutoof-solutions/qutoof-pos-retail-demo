# تشغيل لوحة المنصة والفوترة — Phase 4

هذا الدليل مطلوب قبل فتح لوحة `Super Admin` أو استقبال طلبات الاشتراك. يعتمد التحصيل على التحويل اليدوي ومراجعة صورة الإيصال عبر Telegram؛ لا توجد معالجة بطاقات أو خصم آلي.

## 1. تجهيز موارد Cloudflare

1. أنشئ D1 وKV وR2، ثم استبدل المعرفات الصفرية/الأسماء المحلية في `wrangler.toml` بمعرفات موارد الإنتاج الحقيقية.
2. خذ نسخة احتياطية من D1 قبل أول ترحيل إنتاجي، ثم طبّق migrations بالترتيب:

   ```bash
   npm ci
   npm run db:migrate:remote
   ```

3. اضبط Secrets على مشروع Pages الصحيح. استخدم `wrangler pages secret put <NAME> --project-name qutoof-crm-2` أو لوحة Cloudflare؛ أدخل القيمة عند prompt ولا تضعها في arguments أو Git:

   - `SESSION_SECRET` — مفتاح عشوائي قوي، 32 محرفاً على الأقل.
   - `SUPER_ADMIN_BOOTSTRAP_SECRET` — سر عشوائي مستقل، 32 محرفاً على الأقل، لإجراء الإنشاء الأول فقط.
   - `TELEGRAM_BOT_TOKEN` — رمز البوت من BotFather؛ سرّ خادمي فقط، ولا تضعه في متغير يبدأ بـ `NEXT_PUBLIC_`.
   - `TELEGRAM_CHAT_ID` — معرّف المحادثة المستهدفة؛ له الأولوية عند ضبطه.
   - `TELEGRAM_ADMIN_CHAT_ID` — معرّف المحادثة الاحتياطي للتوافق مع الإعدادات السابقة؛ يُستخدم إذا لم يُضبط `TELEGRAM_CHAT_ID`.
   - `TELEGRAM_ADMIN_USER_ID` — معرف مستخدم Telegram للمالك الذي يضغط الأزرار. يفضّل ضبطه صراحةً.
   - `TELEGRAM_ADMIN_ACCOUNT_ID` — معرف حساب `super_admin` داخل التطبيق؛ اضبطه بعد تنفيذ bootstrap في الخطوة التالية.
   - `TELEGRAM_WEBHOOK_SECRET` — سر Telegram webhook، من 32 إلى 256 محرفاً.
   - `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ENCRYPTION_KEY`, `WHATSAPP_CRON_SECRET` عند تشغيل WhatsApp.
   - `BILLING_CRON_SECRET` — سر مستقل لتصريف إشعارات التحصيل وتسوية الاشتراكات.

عيّن `NEXT_PUBLIC_BASE_URL` إلى عنوان HTTPS النهائي كـ Pages runtime variable، وليس كقيمة محلية فقط. لا تستخدم قيمة `.dev.vars.example` للإنتاج.

## 2. إنشاء أول مالك منصة

بعد نجاح migrations ونشر Pages، استدعِ endpoint التهيئة مرة واحدة. أدخل الأسرار وكلمة المرور في طرفيتك مباشرة، ولا تحفظ الطلب في ملف أو shell history. كلمة المرور 12 محرفاً على الأقل وتحتوي أحرفاً صغيرة وكبيرة ورقماً.

```bash
read -r -p 'البريد الإلكتروني: ' ADMIN_EMAIL
read -r -p 'الاسم الكامل: ' ADMIN_NAME
read -r -p 'عنوان HTTPS النهائي للتطبيق: ' NEXT_PUBLIC_BASE_URL
read -r -s -p 'كلمة المرور: ' ADMIN_PASSWORD; printf '\n'
read -r -s -p 'سر التهيئة: ' BOOTSTRAP_SECRET; printf '\n'
export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD BOOTSTRAP_SECRET NEXT_PUBLIC_BASE_URL
python3 - <<'PY'
import json, os, urllib.request
payload = json.dumps({
    "email": os.environ["ADMIN_EMAIL"],
    "fullName": os.environ["ADMIN_NAME"],
    "password": os.environ["ADMIN_PASSWORD"],
}).encode()
request = urllib.request.Request(
    os.environ["NEXT_PUBLIC_BASE_URL"].rstrip("/") + "/api/internal/bootstrap/super-admin",
    data=payload,
    headers={"Authorization": "Bearer " + os.environ["BOOTSTRAP_SECRET"], "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print(response.read().decode())
except Exception as error:
    print(f"Bootstrap request failed ({type(error).__name__}); verify the endpoint and secrets.")
PY
unset ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD BOOTSTRAP_SECRET NEXT_PUBLIC_BASE_URL
```

تُنشأ هوية `super_admin` واحدة فقط؛ endpoint يرفض التشغيل إذا وُجد مالك سابق أو كان البريد مستخدماً، ولا يغيّر بيانات أي حساب قائم. انسخ `userId` من استجابة النجاح إلى سر Pages `TELEGRAM_ADMIN_ACCOUNT_ID`، ثم احذف `SUPER_ADMIN_BOOTSTRAP_SECRET` بعد التهيئة:

```bash
npx wrangler pages secret delete SUPER_ADMIN_BOOTSTRAP_SECRET --project-name qutoof-crm-2
```

سجّل الدخول من `/login` ثم افتح `/super-admin`. حدّث بيانات الدفع التجريبية في تبويب الإعدادات قبل استقبال أي تحويلات حقيقية.

## 3. إعداد Telegram webhook

البوت لا يعتمد على موصل إضافي. وجّه `TELEGRAM_CHAT_ID` (أو `TELEGRAM_ADMIN_CHAT_ID` الاحتياطي) إلى المحادثة الخاصة بالمالك، واضبط `TELEGRAM_ADMIN_USER_ID` على معرف المستخدم المخول. تُرسل الإيصالات إلى البوت مع بيانات المنشأة ومقدم الطلب (الاسم والبريد والهاتف إن وُجد) والباقة/الدورة وطريقة الدفع والمبلغ ورقم الطلب. تُرسل المحاولة الأولى ضمن طلب الرفع، ثم يعيد العامل المجدول إرسال الإشعارات المؤجلة. بعد ضبط أسرار Pages، سجّل callback queries إلى endpoint:

```bash
read -r -p 'عنوان HTTPS النهائي للتطبيق: ' NEXT_PUBLIC_BASE_URL
read -r -s -p 'Telegram bot token: ' TELEGRAM_BOT_TOKEN; printf '\n'
read -r -s -p 'Telegram webhook secret: ' TELEGRAM_WEBHOOK_SECRET; printf '\n'
export NEXT_PUBLIC_BASE_URL TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
python3 - <<'PY'
import json, os, urllib.parse, urllib.request
token = os.environ["TELEGRAM_BOT_TOKEN"]
payload = urllib.parse.urlencode({
    "url": os.environ["NEXT_PUBLIC_BASE_URL"].rstrip("/") + "/api/webhooks/telegram",
    "secret_token": os.environ["TELEGRAM_WEBHOOK_SECRET"],
    "allowed_updates": json.dumps(["callback_query"]),
}).encode()
request = urllib.request.Request(f"https://api.telegram.org/bot{token}/setWebhook", data=payload, method="POST")
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        print(response.read().decode())
except Exception as error:
    print(f"Telegram webhook request failed ({type(error).__name__}); verify the bot configuration.")
PY
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET NEXT_PUBLIC_BASE_URL
```

Telegram يرسل رأس `X-Telegram-Bot-Api-Secret-Token`؛ endpoint يرفض أي تحديث لا يطابق السر ومعرف المالك. أزرار الموافقة والرفض مشروطة بحالة الطلب ومحمية من إعادة المعالجة؛ الاعتماد ينشئ فاتورة SaaS ويحدّث `platform_plan_id` وتاريخ الانتهاء داخل D1.

## 4. نشر Cron Worker

يستخدم عامل منفصل لأن Pages لا ينفذ Cron Triggers. اضبط `APP_BASE_URL` إلى عنوان Pages النهائي، واضبط السرّين التاليين على **العامل** (ويجب أن يطابق كل واحد سر Pages المقابل):

```bash
npx wrangler secret put APP_BASE_URL --config wrangler.whatsapp-cron.toml
npx wrangler secret put WHATSAPP_CRON_SECRET --config wrangler.whatsapp-cron.toml
npx wrangler secret put BILLING_CRON_SECRET --config wrangler.whatsapp-cron.toml
npm run cron:deploy
```

العامل يرسل رسائل WhatsApp/Telegram المعلقة كل خمس دقائق، ويجري تسوية التجارب والاشتراكات يومياً. تُطبّق الحالة التشغيلية مباشرة عند الطلب كذلك، فلا تعتمد أقفال الاشتراك على انتظار المهمة اليومية.

## 5. تجربة الإطلاق

- أنشئ خطة واحدة على الأقل في تبويب **الباقات** واضبط مدتها وسعرها وميزاتها. مفاتيح الاستحقاق التي تتحكم حالياً في الوحدات المدفوعة هي `public_booking`, `whatsapp`, `branches`, `reports`, `queue`, `pos`؛ غياب المفتاح يمنع الوحدة للمنشأة ذات الخطة، وتبقى حسابات التجربة/الحسابات القديمة بلا خطة غير مقيدة بهذه المفاتيح.
- تحقق من فودافون كاش وQR إنستاباي باستخدام مبالغ اختبارية قبل استقبال أموال فعلية.
- أنشئ منشأة اختبار، فعّل تجربتها يدوياً، وتحقق من عدّ 30 يوماً (أو القيمة التي ضبطتها) ثم مهلة السماح الافتراضية ثلاثة أيام.
- ارفع إيصالاً اختبارياً من حساب المنشأة؛ تحقق من وصول صورة الإيصال وأزرار القرار إلى محادثة المالك، ومن ظهور الفاتورة بعد الموافقة.
- اختبر الرفض، إعادة الرفع، تجميد/فك التجميد، تمديد التجربة، وتوقف صلاحيات العمليات بعد انتهاء المهلة.
- فعّل `maintenance_mode` أو `public_booking` أو `whatsapp` أو `tenant_registration` أو `subscription_billing` مؤقتاً لاختبار أثر القواطع ثم أعدها إلى القيم المطلوبة.
- راجع تبويب سجل التدقيق بعد كل إجراء إداري، وتأكد من أن تنزيل الإيصال متاح للمالك فقط.

## متغيرات محلية

انسخ `.dev.vars.example` إلى `.dev.vars` وضع أسرار اختبار محلية؛ الملف `.dev.vars` مستثنى من Git. لا تستخدم أسرار الإنتاج في بيئة محلية أو Preview عامة. شغّل `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, و`npm run pages:build` قبل كل نشر.
