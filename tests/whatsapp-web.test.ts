import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWhatsAppWebUrl } from "../lib/whatsapp/web";

test("WhatsApp Web links normalize Egyptian local numbers and encode the message", () => {
  assert.equal(buildWhatsAppWebUrl("01012345678", "موعدك غداً"), "https://wa.me/201012345678?text=%D9%85%D9%88%D8%B9%D8%AF%D9%83%20%D8%BA%D8%AF%D8%A7%D9%8B");
  assert.equal(buildWhatsAppWebUrl("+201012345678", "Invoice QT-1"), "https://wa.me/201012345678?text=Invoice%20QT-1");
  assert.equal(buildWhatsAppWebUrl("", "test"), null);
});

test("public sales WhatsApp welcome message is polished and localized", () => {
  const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")) as { landing: { whatsappSupport: { message: string } } };
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as { landing: { whatsappSupport: { message: string } } };
  assert.equal(ar.landing.whatsappSupport.message, "السلام عليكم، أرغب في الاستفسار عن باقات وأنظمة Qutoof Business، وكيفية تهيئة النظام بما يتناسب مع نشاطي التجاري.");
  assert.equal(en.landing.whatsappSupport.message, "Hello, I’d like to learn about Qutoof Business plans and systems and discuss how to tailor the right solution to my business.");
  assert.match(buildWhatsAppWebUrl("201002785919", ar.landing.whatsappSupport.message) ?? "", /^https:\/\/wa\.me\/201002785919\?text=/);
});
