import { hashPassword, createSession, buildSessionCookie } from "@/lib/auth";
import { readOrCreateUserAuthGeneration } from "@/lib/server/session";

const DEMO_TTL_SECONDS = 60 * 60;
const DEMO_TTL_MS = DEMO_TTL_SECONDS * 1000;
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT = 5;
const MAX_ACTIVE_DEMOS = 250;
const CLEANUP_BATCH_SIZE = 50;
const DEMO_TENANT_NAME = "Qutoof Demo Café";
const DEMO_USER_NAME = "Demo Café Manager";
const SESSION_TTL = DEMO_TTL_SECONDS;

export type LiveDemoEnv = { DB: D1Database; KV_BINDING: KVNamespace; SESSION_SECRET?: string };
type DemoCustomer = { id: string; name: string; phone: string; email: string };
type DemoProduct = { id: string; sku: string; name: string; category: string; cost: number; price: number; stock: number };
type DemoSale = { number: string; customerIndex: number; minutesAgo: number; payment: "cash" | "card" | "wallet"; lines: Array<{ productIndex: number; quantity: number }> };

const products: DemoProduct[] = [
  { id: "p1", sku: "CAFE-001", name: "قهوة لاتيه | Latte", category: "مشروبات ساخنة | Hot drinks", cost: 2800, price: 5500, stock: 42 },
  { id: "p2", sku: "CAFE-002", name: "كابتشينو | Cappuccino", category: "مشروبات ساخنة | Hot drinks", cost: 2600, price: 5200, stock: 35 },
  { id: "p3", sku: "CAFE-003", name: "قهوة أمريكية | Americano", category: "مشروبات ساخنة | Hot drinks", cost: 1900, price: 4200, stock: 51 },
  { id: "p4", sku: "CAFE-004", name: "شاي نعناع | Mint tea", category: "مشروبات ساخنة | Hot drinks", cost: 900, price: 2500, stock: 28 },
  { id: "p5", sku: "CAFE-005", name: "كرواسون | Croissant", category: "مخبوزات | Bakery", cost: 2200, price: 4500, stock: 18 },
  { id: "p6", sku: "CAFE-006", name: "تشيز كيك | Cheesecake", category: "حلويات | Desserts", cost: 3500, price: 6800, stock: 12 },
  { id: "p7", sku: "CAFE-007", name: "عصير برتقال | Orange juice", category: "مشروبات باردة | Cold drinks", cost: 2400, price: 5000, stock: 22 },
  { id: "p8", sku: "CAFE-008", name: "مياه معدنية | Mineral water", category: "مشروبات باردة | Cold drinks", cost: 500, price: 1500, stock: 60 },
];
const customers: DemoCustomer[] = [
  { id: "c1", name: "عميل تجريبي 01 | Demo customer 01", phone: "DEMO-0001", email: "demo-customer-01@example.invalid" },
  { id: "c2", name: "عميل تجريبي 02 | Demo customer 02", phone: "DEMO-0002", email: "demo-customer-02@example.invalid" },
  { id: "c3", name: "عميل تجريبي 03 | Demo customer 03", phone: "DEMO-0003", email: "demo-customer-03@example.invalid" },
  { id: "c4", name: "عميل تجريبي 04 | Demo customer 04", phone: "DEMO-0004", email: "demo-customer-04@example.invalid" },
  { id: "c5", name: "عميل تجريبي 05 | Demo customer 05", phone: "DEMO-0005", email: "demo-customer-05@example.invalid" },
];
const sales: DemoSale[] = [
  { number: "DEMO-1001", customerIndex: 0, minutesAgo: 180, payment: "cash", lines: [{ productIndex: 0, quantity: 2 }, { productIndex: 4, quantity: 1 }] },
  { number: "DEMO-1002", customerIndex: 1, minutesAgo: 125, payment: "card", lines: [{ productIndex: 1, quantity: 1 }, { productIndex: 5, quantity: 1 }] },
  { number: "DEMO-1003", customerIndex: 2, minutesAgo: 67, payment: "wallet", lines: [{ productIndex: 2, quantity: 2 }, { productIndex: 3, quantity: 1 }] },
  { number: "DEMO-1004", customerIndex: 3, minutesAgo: 24, payment: "cash", lines: [{ productIndex: 0, quantity: 1 }, { productIndex: 6, quantity: 1 }, { productIndex: 7, quantity: 2 }] },
];

function uuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(kv: KVNamespace, request: Request): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return false;
  const key = `live-demo-rate:${await digest(ip)}`;
  const current = Number(await kv.get(key) ?? "0");
  if (!Number.isSafeInteger(current) || current >= RATE_LIMIT) return false;
  await kv.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  return true;
}

async function cleanupExpiredDemos(env: LiveDemoEnv, now: number): Promise<void> {
  const expired = await env.DB.prepare(
    "SELECT id, CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.userId') END AS user_id FROM tenants WHERE CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.expiresAt') END <= ? AND CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.marker') END = 'qutoof-live-demo-v1' AND CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.archivedAt') END IS NULL LIMIT ?",
  ).bind(now, CLEANUP_BATCH_SIZE).all<{ id: string; user_id: string | null }>();
  if (!expired.results.length) return;
  const archiveStatements = expired.results.flatMap(({ id, user_id }) => [
    ...(user_id ? [env.DB.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?").bind(now, user_id, id)] : []),
    env.DB.prepare("UPDATE tenants SET status = 'expired', settings_json = json_set(settings_json, '$.liveDemo.archivedAt', ?), updated_at = ? WHERE id = ? AND CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.marker') END = 'qutoof-live-demo-v1'").bind(now, now, id),
  ]);
  await env.DB.batch(archiveStatements);
  await Promise.all(expired.results.flatMap(({ user_id }) => user_id ? [
    env.KV_BINDING.delete(`session:${user_id}`).catch(() => undefined),
    env.KV_BINDING.delete(`auth-generation:${user_id}`).catch(() => undefined),
  ] : []));
}

async function revokeProvisionedDemo(env: LiveDemoEnv, tenantId: string, userId: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?").bind(now, userId, tenantId),
    env.DB.prepare("UPDATE tenants SET status = 'expired', settings_json = json_set(settings_json, '$.liveDemo.archivedAt', ?), updated_at = ? WHERE id = ? AND CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.marker') END = 'qutoof-live-demo-v1'").bind(now, now, tenantId),
  ]).catch(() => undefined);
  await Promise.all([
    env.KV_BINDING.delete(`session:${userId}`).catch(() => undefined),
    env.KV_BINDING.delete(`auth-generation:${userId}`).catch(() => undefined),
  ]);
}

function buildSeedStatements(env: LiveDemoEnv, input: { tenantId: string; userId: string; branchId: string; warehouseId: string; now: number; expiresAt: number; email: string; passwordHash: string }) {
  const { tenantId, userId, branchId, warehouseId, now, expiresAt, email, passwordHash } = input;
  const demoSettings = JSON.stringify({
    onboarding: { required: false, version: 1, completedAt: new Date(now).toISOString() },
    liveDemo: { marker: "qutoof-live-demo-v1", userId, expiresAt },
  });
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO tenants (id,name,slug,vertical,status,timezone,settings_json,created_at,updated_at) VALUES (?,?,?,'restaurant','active','Africa/Cairo',?,?,?)")
      .bind(tenantId, DEMO_TENANT_NAME, `demo-${tenantId.slice(-16)}`, demoSettings, now, now),
    env.DB.prepare("INSERT INTO users (id,tenant_id,email,password_hash,full_name,role,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'business_admin',1,?,?)")
      .bind(userId, tenantId, email, passwordHash, DEMO_USER_NAME, now, now),
    env.DB.prepare("INSERT INTO branches (id,tenant_id,name,name_ar,name_en,is_active,created_at,updated_at) VALUES (?,?,?,'فرع العرض','Demo branch',1,?,?)")
      .bind(branchId, tenantId, "فرع العرض | Demo branch", now, now),
    env.DB.prepare("INSERT INTO branch_memberships (id,tenant_id,user_id,branch_id,created_at) VALUES (?,?,?,?,?)")
      .bind(uuid("demo-membership"), tenantId, userId, branchId, now),
    env.DB.prepare("INSERT INTO inventory_warehouses (id,tenant_id,branch_id,code,name,is_active,created_at,updated_at) VALUES (?,?,?,'CAFE-MAIN','المخزن الرئيسي | Main stockroom',1,?,?)")
      .bind(warehouseId, tenantId, branchId, now, now),
  ];

  const productIds = products.map(() => uuid("demo-product"));
  const customerIds = customers.map(() => uuid("demo-customer"));
  const invoiceIds = sales.map(() => uuid("demo-sale"));
  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const id = productIds[i];
    statements.push(env.DB.prepare("INSERT INTO inventory_items (id,tenant_id,sku,name,description,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,selling_price_minor,wholesale_price_minor,distributor_price_minor,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?, 'piece',0,?,?,?,?,?,1,?,?)")
      .bind(id, tenantId, product.sku, product.name, "بيانات اصطناعية لعرض النظام | Synthetic data for product demonstration", product.category, 5, product.cost, product.price, product.price, product.price, now, now));
    statements.push(env.DB.prepare("INSERT INTO inventory_balances (id,tenant_id,item_id,warehouse_id,batch_key,quantity_on_hand,updated_at) VALUES (?,?,?,?, '', ?,?)")
      .bind(uuid("demo-balance"), tenantId, id, warehouseId, 0, now));
  }
  const soldByProduct = products.map((_, productIndex) => sales.reduce((sum, sale) => sum + sale.lines.filter((line) => line.productIndex === productIndex).reduce((lineSum, line) => lineSum + line.quantity, 0), 0));
  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const operationId = uuid("demo-opening-operation");
    const openingQuantity = product.stock + soldByProduct[i];
    statements.push(env.DB.prepare("INSERT INTO stock_operations (id,tenant_id,operation_type,idempotency_key,reference_type,reference_id,created_by,notes,metadata_json,created_at) VALUES (?,?,'adjustment',?,'demo_opening',?,?,?,'{}',?)")
      .bind(operationId, tenantId, `demo-opening-${product.sku}`, product.sku, userId, "Synthetic demo opening stock", now - 4 * 60 * 60_000));
    statements.push(env.DB.prepare("INSERT INTO stock_movements (id,tenant_id,operation_id,item_id,warehouse_id,movement_type,quantity_delta,reference_type,reference_id,note,created_by,created_at) VALUES (?,?,?, ?,?,'adjustment',?,'demo_opening',?,?,?,?)")
      .bind(uuid("demo-opening-movement"), tenantId, operationId, productIds[i], warehouseId, openingQuantity, product.sku, "Synthetic opening stock", userId, now - 4 * 60 * 60_000));
  }
  for (let i = 0; i < customers.length; i += 1) {
    const customer = customers[i];
    statements.push(env.DB.prepare("INSERT INTO customers (id,tenant_id,branch_id,full_name,phone,email,notes,gender,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'unspecified',?,?)")
      .bind(customerIds[i], tenantId, branchId, customer.name, customer.phone, customer.email, "سجل تجريبي ببيانات غير حقيقية | Synthetic demo record", now, now));
  }
  for (let i = 0; i < sales.length; i += 1) {
    const sale = sales[i];
    const invoiceId = invoiceIds[i];
    const saleTime = now - sale.minutesAgo * 60_000;
    const lineAmounts = sale.lines.map((line) => products[line.productIndex].price * line.quantity);
    const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
    const operationId = uuid("demo-sale-operation");
    statements.push(env.DB.prepare("INSERT INTO stock_operations (id,tenant_id,operation_type,idempotency_key,reference_type,reference_id,created_by,notes,metadata_json,created_at) VALUES (?,?,'point_of_sale',?,'invoice',?,?,?,'{}',?)")
      .bind(operationId, tenantId, `demo-sale-${sale.number}`, invoiceId, userId, "Synthetic demo sale stock movement", saleTime));
    statements.push(env.DB.prepare("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,order_type,paid_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?,'EGP',?,'paid','dine_in',?,?,?)")
      .bind(invoiceId, tenantId, branchId, customerIds[sale.customerIndex], userId, sale.number, total, total, total, sale.payment, saleTime, saleTime, saleTime));
    for (let lineIndex = 0; lineIndex < sale.lines.length; lineIndex += 1) {
      const line = sale.lines[lineIndex];
      const product = products[line.productIndex];
      statements.push(env.DB.prepare("INSERT INTO invoice_items (id,tenant_id,invoice_id,inventory_item_id,stock_warehouse_id,quantity_scale,description,quantity,unit_price_minor,line_total_minor,price_tier,commission_bps,created_at) VALUES (?,?,?,?,?,0,?,?,?,?,'retail',0,?)")
        .bind(uuid("demo-line"), tenantId, invoiceId, productIds[line.productIndex], warehouseId, product.name, line.quantity, product.price, lineAmounts[lineIndex], saleTime));
      statements.push(env.DB.prepare("INSERT INTO stock_movements (id,tenant_id,operation_id,item_id,warehouse_id,movement_type,quantity_delta,reference_type,reference_id,note,created_by,created_at) VALUES (?,?,?,?,?,'pos_deduction',?,'invoice',?,?,?,?)")
        .bind(uuid("demo-sale-movement"), tenantId, operationId, productIds[line.productIndex], warehouseId, -line.quantity, invoiceId, "Synthetic demo POS sale", userId, saleTime));
    }
    statements.push(env.DB.prepare("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(uuid("demo-payment"), tenantId, invoiceId, userId, total, sale.payment, `Synthetic demo payment ${sale.number}`, saleTime));
  }
  return statements;
}

export async function createLiveDemo(request: Request, env: LiveDemoEnv): Promise<Response> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let provisioned: { tenantId: string; userId: string } | undefined;
  try {
    if (!(await checkRateLimit(env.KV_BINDING, request))) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(RATE_WINDOW_SECONDS) } });
    const now = Date.now();
    await cleanupExpiredDemos(env, now);
    const active = await env.DB.prepare("SELECT COUNT(*) AS count FROM tenants WHERE CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.marker') END = 'qutoof-live-demo-v1' AND CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.liveDemo.expiresAt') END > ?")
      .bind(now).first<{ count: number }>();
    if ((active?.count ?? 0) >= MAX_ACTIVE_DEMOS) return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    provisioned = { tenantId, userId };
    const branchId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const expiresAt = now + DEMO_TTL_MS;
    const email = `live-demo-${userId}@example.invalid`;
    const passwordHash = await hashPassword(`${crypto.randomUUID()}-${crypto.randomUUID()}`);
    await env.DB.batch(buildSeedStatements(env, { tenantId, userId, branchId, warehouseId, now, expiresAt, email, passwordHash }));

    const authGeneration = await readOrCreateUserAuthGeneration(env.KV_BINDING, userId);
    await env.KV_BINDING.put(`session:${userId}`, "active", { expirationTtl: SESSION_TTL });

    const token = await createSession({ sub: userId, tenantId, role: "business_admin", email, fullName: DEMO_USER_NAME, authGeneration }, env.SESSION_SECRET);
    const headers = new Headers({ "Cache-Control": "no-store", "Set-Cookie": buildSessionCookie(token, request.url, DEMO_TTL_SECONDS) });
    return Response.json({ redirectTo: "/dashboard/pos", expiresAt }, { status: 201, headers });
  } catch {
    if (provisioned) await revokeProvisionedDemo(env, provisioned.tenantId, provisioned.userId);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const liveDemoSessionTtlSeconds = DEMO_TTL_SECONDS;
export const liveDemoCatalogCounts = { categories: new Set(products.map((item) => item.category)).size, products: products.length, customers: customers.length, sales: sales.length, maxActiveDemos: MAX_ACTIVE_DEMOS, sessionTtlSeconds: DEMO_TTL_SECONDS } as const;
