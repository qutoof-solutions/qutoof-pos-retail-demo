import test from "node:test";
import assert from "node:assert/strict";
import { replyToMessage } from "@/lib/support/chatbot";

test("support chatbot answers Arabic industry questions and suggests a path", () => {
  const reply = replyToMessage("أنا عندي عيادة وعايز ملفات للمرضى", "ar");
  assert.equal(reply.suggestedPlan, "medical");
  assert.match(reply.answer, /عيادة/);
});

test("support chatbot answers English trial questions", () => {
  const reply = replyToMessage("How does the trial work?", "en");
  assert.equal(reply.canEscalate, false);
  assert.match(reply.answer, /trial/i);
});

test("unknown questions can be escalated in both languages", () => {
  assert.equal(replyToMessage("أحتاج مساعدة خاصة", "ar").canEscalate, true);
  assert.equal(replyToMessage("I need an agent", "en").canEscalate, true);
});
