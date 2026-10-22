import { getRequestContext } from "@cloudflare/next-on-pages";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { safeEqual } from "@/lib/whatsapp/security";

export const runtime = "edge";
const inputSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const env = getRequestContext().env as { DB: D1Database; KV_BINDING: KVNamespace; SESSION_SECRET?: string; SUPER_ADMIN_BOOTSTRAP_SECRET?: string };
  const expected = env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  if (!expected || expected.length < 32 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return Response.json({ error: "خدمة التهيئة الأولية غير مهيأة" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), expected)) return Response.json({ error: "غير مصرح" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 16_000) return Response.json({ error: "الطلب أكبر من الحد المسموح" }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 16_000) return Response.json({ error: "الطلب أكبر من الحد المسموح" }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { body = null; }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "أدخل بريداً واسم مالك وكلمة مرور قوية (12 حرفاً على الأقل)" }, { status: 400 });
  const { email, fullName, password } = parsed.data;
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) SELECT ?, NULL, ?, ?, ?, 'super_admin', 1, unixepoch(), unixepoch() WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin' AND tenant_id IS NULL) AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)").bind(id, email, passwordHash, fullName, email),
      env.DB.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, metadata_json, created_at) SELECT ?, NULL, ?, 'platform.super_admin_bootstrapped', 'user', ?, '{}', unixepoch() WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'super_admin' AND tenant_id IS NULL)").bind(crypto.randomUUID(), id, id, id),
    ]);
  } catch { return Response.json({ error: "تعذر إنشاء حساب مالك المنصة" }, { status: 409, headers: { "Cache-Control": "no-store" } }); }
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) return Response.json({ error: "يوجد مالك منصة مسبقاً أو البريد مستخدم؛ لا تُستبدل الحسابات تلقائياً" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  try { await env.KV_BINDING.put(`session:${id}`, "active", { expirationTtl: 60 * 60 * 12 }); }
  catch { return Response.json({ error: "أُنشئ الحساب، لكن تعذر إنشاء جلسة KV؛ تحقق من binding ثم سجّل الدخول" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  return Response.json({ created: true, userId: id, email, fullName, message: "تم إنشاء أول مالك للمنصة. احذف SUPER_ADMIN_BOOTSTRAP_SECRET من بيئة الإنتاج بعد إتمام التهيئة." }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
