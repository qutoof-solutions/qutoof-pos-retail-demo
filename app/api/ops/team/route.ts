import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { users } from "@/lib/db/schema";
import { strongPasswordSchema } from "@/lib/password-policy";
import { STAFF_ASSIGNABLE_ROLES, isOwnerRole } from "@/lib/operations/permissions";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getTenantResourceLimit } from "@/lib/platform/addon-entitlement-query";
import { isProviderSeat } from "@/lib/platform/addon-entitlements";

export const runtime = "edge";
const roleSchema = z.enum(STAFF_ASSIGNABLE_ROLES);
const createInput = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), role: roleSchema, password: strongPasswordSchema });

async function requireOwner(request: Request) {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access;
  return isOwnerRole(access.context.session.role)
    ? access
    : { ok: false as const, response: Response.json({ error: "إدارة حسابات الفريق متاحة لمالك النشاط فقط" }, { status: 403 }) };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOwner(request);
  if (!access.ok) return access.response;
  const team = await access.context.db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users).where(and(eq(users.tenantId, access.context.tenantId), ne(users.role, "super_admin"))).orderBy(asc(users.fullName));
  return Response.json({ team }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOwner(request);
  if (!access.ok) return access.response;
  try {
    const parsed = createInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من الاسم والبريد وكلمة مرور قوية لا تقل عن 12 حرفاً");
    const input = parsed.data;
    const email = input.email.toLowerCase();
    const [userCounts, doctorCounts] = await Promise.all([
      access.context.db.select({ value: count() }).from(users).where(and(eq(users.tenantId, access.context.tenantId), ne(users.role, "super_admin"))),
      access.context.db.select({ value: count() }).from(users).where(and(eq(users.tenantId, access.context.tenantId), inArray(users.role, ["provider", "doctor", "specialist"]))),
    ]);
    const [userLimit, doctorLimit] = await Promise.all([
      getTenantResourceLimit(access.context.db, access.context.tenantId, "user"),
      isProviderSeat(input.role) ? getTenantResourceLimit(access.context.db, access.context.tenantId, "doctor") : Promise.resolve(null),
    ]);
    if (userLimit !== null && (userCounts[0]?.value ?? 0) >= userLimit) throw new ApiError("وصلت إلى الحد الحالي للمستخدمين. اطلب مستخدماً إضافياً من صفحة الفوترة بعد اعتماد التحويل.", 409);
    if (doctorLimit !== null && (doctorCounts[0]?.value ?? 0) >= doctorLimit) throw new ApiError("وصلت إلى الحد الحالي للأطباء. اطلب طبيباً إضافياً من صفحة الفوترة بعد اعتماد التحويل.", 409);
    const [existing] = await access.context.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ApiError("البريد الإلكتروني مستخدم بالفعل", 409);
    const id = crypto.randomUUID();
    const now = new Date();
    const [created] = await access.context.db.insert(users).values({ id, tenantId: access.context.tenantId, email, passwordHash: await hashPassword(input.password), fullName: input.fullName, role: input.role, isActive: true, createdAt: now, updatedAt: now }).returning({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt });
    await writeAudit(access.context, request, "team_member.created", "user", id, { role: input.role });
    return Response.json({ member: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
