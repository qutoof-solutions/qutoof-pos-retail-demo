import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { distributionRoutes } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";

export const runtime = "edge";
const createSchema = z.object({ branchId: uuidSchema, code: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_-]+$/u), name: z.string().trim().min(2).max(100), area: z.string().trim().min(2).max(120), notes: z.string().trim().max(500).nullable().optional() });
const patchSchema = z.object({ id: uuidSchema, isActive: z.boolean().optional(), code: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_-]+$/u).optional(), name: z.string().trim().min(2).max(100).optional(), area: z.string().trim().min(2).max(120).optional(), notes: z.string().trim().max(500).nullable().optional() }).refine((value) => Object.keys(value).length > 1, { message: "حدد حقلاً واحداً على الأقل للتحديث" });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  try {
    if (branchId) await requireBranchMembership(access.context, branchId);
    const filters = [eq(distributionRoutes.tenantId, access.context.tenantId)];
    if (branchId) filters.push(eq(distributionRoutes.branchId, branchId));
    const routes = await access.context.db.select().from(distributionRoutes).where(and(...filters)).orderBy(asc(distributionRoutes.name));
    return Response.json({ routes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "تعذر تحميل خطوط السير"); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات خط السير");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const now = new Date();
    const route = { id: crypto.randomUUID(), tenantId: access.context.tenantId, branchId: input.branchId, code: input.code.toUpperCase(), name: input.name, area: input.area, notes: input.notes ?? null, isActive: true, createdBy: access.context.user.id, createdAt: now, updatedAt: now };
    await access.context.db.insert(distributionRoutes).values(route).run();
    await writeAudit(access.context, request, "distribution.route.created", "distribution_route", route.id, { branchId: route.branchId, code: route.code });
    return Response.json({ route }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (String(error).includes("distribution_routes_tenant_code_uq") || String(error).includes("distribution_routes_tenant_branch_name_uq")) return Response.json({ error: "رمز أو اسم خط السير مستخدم بالفعل في هذا الفرع" }, { status: 409 });
    return errorResponse(error, "تعذر إنشاء خط السير");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات التحديث غير صالحة");
    const [route] = await access.context.db.select().from(distributionRoutes).where(and(eq(distributionRoutes.id, parsed.data.id), eq(distributionRoutes.tenantId, access.context.tenantId))).limit(1);
    if (!route) throw new ApiError("خط السير غير موجود", 404);
    await requireBranchMembership(access.context, route.branchId);
    await access.context.db.update(distributionRoutes).set({ ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}), ...(parsed.data.code !== undefined ? { code: parsed.data.code.toUpperCase() } : {}), ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}), ...(parsed.data.area !== undefined ? { area: parsed.data.area } : {}), ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}), updatedAt: new Date() }).where(and(eq(distributionRoutes.id, route.id), eq(distributionRoutes.tenantId, access.context.tenantId))).run();
    await writeAudit(access.context, request, "distribution.route.status_changed", "distribution_route", route.id, { ...parsed.data });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "تعذر تحديث خط السير"); }
}
