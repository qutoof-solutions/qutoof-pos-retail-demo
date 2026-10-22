import { buildExpiredSessionCookie, buildNamedSessionCookie, ADMIN_BACKUP_COOKIE, hashPassword, verifyPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/password-policy";
import { requireSuperAdminAccess, writePlatformAudit } from "@/lib/server/super-admin";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const access = await requireSuperAdminAccess(request);
  if (!access.ok) return access.response;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403, headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      return Response.json({ error: "الطلب غير مسموح من هذا النطاق" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "بيانات تغيير كلمة المرور غير صالحة" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const { currentPassword, newPassword } = parsed.data;
  if (!(await verifyPassword(currentPassword, access.context.user.passwordHash))) {
    return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let newHash: string;
  try {
    newHash = await hashPassword(newPassword);
  } catch {
    return Response.json({ error: "تعذر تغيير كلمة المرور؛ أعد المحاولة" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  let update: D1Result;
  try {
    update = await access.context.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ? AND password_hash = ? AND role = 'super_admin' AND tenant_id IS NULL AND is_active = 1")
      .bind(newHash, access.context.user.id, access.context.user.passwordHash).run();
  } catch {
    return Response.json({ error: "تعذر حفظ كلمة المرور؛ أعد المحاولة" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (update.meta.changes !== 1) {
    return Response.json({ error: "تغيرت بيانات الحساب في طلب آخر؛ أعد تحميل الصفحة وسجّل الدخول مجدداً" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const [sessionRevocation, auditWrite] = await Promise.allSettled([
    access.context.env.KV_BINDING.delete(`session:${access.context.user.id}`),
    writePlatformAudit(access.context, request, "super_admin.password_changed", "user", access.context.user.id),
  ]);
  const warnings: string[] = [];
  if (sessionRevocation.status === "rejected") warnings.push("تعذر تأكيد إنهاء الجلسات الأخرى؛ قد تظل فعالة حتى انتهاء صلاحيتها خلال 12 ساعة.");
  if (auditWrite.status === "rejected") warnings.push("تعذر تسجيل هذا التغيير في سجل التدقيق.");

  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildExpiredSessionCookie(request.url));
  headers.append("Set-Cookie", buildNamedSessionCookie(ADMIN_BACKUP_COOKIE, "", request.url, 0, "Strict"));
  return Response.json({
    message: sessionRevocation.status === "fulfilled"
      ? "تم تغيير كلمة المرور وإنهاء الجلسات. سجّل الدخول مجدداً بالكلمة الجديدة."
      : "تم تغيير كلمة المرور. سجّل الدخول مجدداً، وراجع التنبيه المتعلق بإنهاء الجلسات.",
    warnings,
  }, { headers });
}
