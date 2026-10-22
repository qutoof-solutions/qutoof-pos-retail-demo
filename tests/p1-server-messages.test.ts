import assert from "node:assert/strict";
import test from "node:test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { messageForLocale, resolveRequestLocale, serverMessage } from "../lib/i18n/p1-server-messages";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/p1", { headers });
}

test("P1 server messages stay bilingual and preserve interpolation", () => {
  assert.notEqual(ar.p1Server.financial.accountingBasis, en.p1Server.financial.accountingBasis);
  assert.equal(messageForLocale("en", "p1Server.publicManage.cancellationWindow", { minutes: 30 }), "Changes or cancellation are available until 30 minutes before the appointment");
  assert.equal(messageForLocale("ar", "p1Server.publicManage.rescheduleLimit", { count: 2 }), "تم بلوغ الحد الأقصى لإعادة الجدولة (2)");
});

test("server locale prefers the locale cookie and otherwise accepts English", () => {
  assert.equal(resolveRequestLocale(request({ cookie: "qutoof-locale=en", "accept-language": "ar-EG" })), "en");
  assert.equal(resolveRequestLocale(request({ "accept-language": "en-US,en;q=0.9" })), "en");
  assert.equal(resolveRequestLocale(request({ "accept-language": "fr-FR" })), "ar");
  assert.equal(serverMessage(request({ "accept-language": "en-US" }), "p1Server.gate.expired"), "The ticket has expired");
});
