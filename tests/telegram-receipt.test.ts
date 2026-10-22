import assert from "node:assert/strict";
import test from "node:test";
import { sendAddonReceiptToOwner, sendBillingReceiptToOwner } from "../lib/platform/telegram";

const telegramEnv = { TELEGRAM_BOT_TOKEN: "test-token-not-a-secret", TELEGRAM_CHAT_ID: "  -100123  " };

function withFetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("subscription receipt is sent with sendPhoto, requester details, plan, and escaped caption text", async () => {
  let requestUrl = "";
  let form: FormData | undefined;
  const restore = withFetchMock(async (input, init) => {
    requestUrl = String(input);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof FormData);
    form = init.body;
    return jsonResponse({ ok: true, result: { message_id: 987 } });
  });
  try {
    const messageId = await sendBillingReceiptToOwner(telegramEnv, {
      requestId: "6af12438-2c9d-4a3d-8378-dceeeae28e1a",
      tenantName: "Bakery & Co <Main>",
      tenantSlug: "bakery-main",
      requesterName: "Omar <Owner>",
      requesterEmail: "omar&shop@example.com",
      requesterPhone: "+20100000000",
      planName: "Pro & Plus",
      cycleLabel: "سنوية",
      paymentMethodLabel: "InstaPay",
      amountMinor: 125000,
      currency: "EGP",
      receipt: new Uint8Array([1, 2, 3, 4]),
      receiptContentType: "image/png",
      createdAt: new Date("2026-10-20T10:00:00.000Z"),
    });

    assert.equal(messageId, "987");
    assert.match(requestUrl, /\/bottest-token-not-a-secret\/sendPhoto$/);
    assert.ok(form);
    assert.equal(form.get("chat_id"), "-100123");
    const caption = String(form.get("caption"));
    assert.match(caption, /Bakery &amp; Co &lt;Main&gt;/);
    assert.match(caption, /Omar &lt;Owner&gt;/);
    assert.match(caption, /omar&amp;shop@example\.com/);
    assert.match(caption, /\+20100000000/);
    assert.match(caption, /Pro &amp; Plus/);
    assert.match(caption, /سنوية/);
    const photo = form.get("photo");
    assert.ok(photo instanceof Blob);
    assert.equal(photo.type, "image/png");
    assert.equal((photo as File).name, "receipt-6af12438-2c9d-4a3d-8378-dceeeae28e1a.png");
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    const markup = JSON.parse(String(form.get("reply_markup"))) as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    assert.equal(markup.inline_keyboard[0]?.[0]?.callback_data, "approve:6af12438-2c9d-4a3d-8378-dceeeae28e1a");
  } finally {
    restore();
  }
});

test("resource add-on receipt includes submitter and add-on choice in Telegram photo caption", async () => {
  let form: FormData | undefined;
  const restore = withFetchMock(async (_input, init) => {
    assert.ok(init?.body instanceof FormData);
    form = init.body;
    return jsonResponse({ ok: true, result: { message_id: 654 } });
  });
  try {
    const messageId = await sendAddonReceiptToOwner(telegramEnv, {
      requestId: "6af12438-2c9d-4a3d-8378-dceeeae28e1a",
      tenantName: "Clinic",
      tenantSlug: "clinic",
      requesterName: "Mona",
      requesterEmail: "mona@example.test",
      requesterPhone: null,
      addonName: "Extra branch",
      quantity: 2,
      paymentMethodLabel: "Vodafone Cash",
      amountMinor: 35000,
      currency: "EGP",
      subscriptionEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      receipt: new Uint8Array([9, 8, 7]),
      receiptContentType: "image/jpeg",
      createdAt: new Date("2026-10-20T10:00:00.000Z"),
    });

    assert.equal(messageId, "654");
    assert.ok(form);
    const caption = String(form.get("caption"));
    assert.match(caption, /Mona/);
    assert.match(caption, /mona@example\.test/);
    assert.match(caption, /Extra branch/);
    assert.match(caption, /العدد: 2/);
    assert.equal((form.get("photo") as File).type, "image/jpeg");
  } finally {
    restore();
  }
});

test("Telegram HTTP and API-level failures are reported to the retry queue", async () => {
  const input = {
    requestId: "6af12438-2c9d-4a3d-8378-dceeeae28e1a",
    tenantName: "Clinic",
    tenantSlug: "clinic",
    requesterName: "Mona",
    requesterEmail: "mona@example.test",
    requesterPhone: null,
    planName: "Standard",
    cycleLabel: "شهرية",
    paymentMethodLabel: "InstaPay",
    amountMinor: 10000,
    currency: "EGP",
    receipt: new Uint8Array([1]),
    receiptContentType: "image/jpeg",
    createdAt: new Date("2026-10-20T10:00:00.000Z"),
  };

  const restoreHttpFailure = withFetchMock(async () => new Response("unavailable", { status: 502 }));
  try {
    await assert.rejects(() => sendBillingReceiptToOwner(telegramEnv, input), /Telegram API returned HTTP 502/);
  } finally {
    restoreHttpFailure();
  }

  const restoreApiFailure = withFetchMock(async () => jsonResponse({ ok: false, description: "Bad Request" }));
  try {
    await assert.rejects(() => sendBillingReceiptToOwner(telegramEnv, input), /Telegram API rejected the billing notification/);
  } finally {
    restoreApiFailure();
  }
});
