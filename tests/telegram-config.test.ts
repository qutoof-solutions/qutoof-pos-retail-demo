import assert from "node:assert/strict";
import test from "node:test";
import { getTelegramChatId } from "../lib/platform/telegram";

test("Telegram notifications prefer TELEGRAM_CHAT_ID", () => {
  assert.equal(getTelegramChatId({ TELEGRAM_CHAT_ID: "  -100123  ", TELEGRAM_ADMIN_CHAT_ID: "legacy" }), "-100123");
});

test("legacy Telegram chat ID remains supported", () => {
  assert.equal(getTelegramChatId({ TELEGRAM_ADMIN_CHAT_ID: "legacy-chat" }), "legacy-chat");
});

test("empty Telegram chat ID is treated as unconfigured", () => {
  assert.equal(getTelegramChatId({ TELEGRAM_CHAT_ID: "  ", TELEGRAM_ADMIN_CHAT_ID: " " }), undefined);
});
