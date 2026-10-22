const CACHE_NAME = "qutoof-static-v5-brand";
const PRECACHE = [
  "/offline-fallback.html",
  "/icons/qutoof-business-pwa-192.png",
  "/icons/qutoof-business-pwa-512.png",
  "/brand/qutoof-business-mark-dark.png",
  "/brand/qutoof-business-mark-light.png",
  "/brand/qutoof-business-logo-dark.png",
  "/brand/qutoof-business-logo-light.png",
  "/manifest.webmanifest",
];
const POS_DB_NAME = "qutoof-pos-offline-v1";
const POS_DB_VERSION = 1;
const POS_INVOICES_STORE = "invoices";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("qutoof-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function openPosDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POS_DB_NAME, POS_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open POS queue"));
  });
}

function getPendingInvoices(tenantId, userId) {
  return openPosDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(POS_INVOICES_STORE, "readonly");
    const request = tx.objectStore(POS_INVOICES_STORE).index("scopeState").getAll(IDBKeyRange.only([tenantId, userId, "pending_sync"]));
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error || new Error("Could not read POS queue"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not read POS queue")); };
  }));
}

function saveInvoice(invoice) {
  return openPosDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(POS_INVOICES_STORE, "readwrite");
    tx.objectStore(POS_INVOICES_STORE).put(invoice);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not update POS queue")); };
  }));
}

async function syncPosQueue(tag) {
  const prefix = "qutoof-pos-sync-";
  if (!tag.startsWith(prefix)) return;
  const scope = tag.slice(prefix.length);
  const tenantId = scope.slice(0, 36);
  const userId = scope.slice(37);
  if (tenantId.length !== 36 || !userId) return;
  const queue = await getPendingInvoices(tenantId, userId);
  for (const record of queue) {
    const response = await fetch("/api/ops/invoices", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(record.payload),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.invoice && body.invoice.invoiceNumber) {
      record.state = "synced";
      record.serverInvoiceNumber = body.invoice.invoiceNumber;
      record.lastError = undefined;
      record.receipt = Object.assign({}, record.receipt, { syncStatus: "synced", offlineLocalNumber: record.localNumber, serverInvoiceNumber: body.invoice.invoiceNumber });
      await saveInvoice(record);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: "POS_OFFLINE_INVOICE_SYNCED", id: record.id, invoiceNumber: body.invoice.invoiceNumber }));
      continue;
    }
    if (response.status >= 500 || response.status === 401 || response.status === 429 || body.retryable) throw new Error(body.error || "POS sync will retry");
    record.state = "needs_attention";
    record.lastError = body.error || "Invoice needs manager review";
    await saveInvoice(record);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "POS_OFFLINE_INVOICE_NEEDS_ATTENTION", id: record.id }));
  }
}

self.addEventListener("sync", (event) => {
  if (!event.tag.startsWith("qutoof-pos-sync-")) return;
  event.waitUntil(syncPosQueue(event.tag));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "POS_OFFLINE_SYNC" && typeof event.data.tag === "string") {
    event.waitUntil(syncPosQueue(event.data.tag));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses, authenticated application pages, or user-specific Next data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/super-admin") || url.pathname.startsWith("/_next/data/")) return;

  // Immutable build assets and public brand assets are safe for cache-first delivery.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  // Navigation stays network-first; offline mode returns a generic page with no business data.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline-fallback.html")) ?? new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
  }
});
