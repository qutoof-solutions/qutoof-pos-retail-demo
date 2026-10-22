import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { branchMemberships, branches } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleBranchIds } from "@/lib/server/branch-access";
import { getTenantResourceLimit } from "@/lib/platform/addon-entitlement-query";

export const runtime = "edge";
const optionalBranchDetails = {
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  mapUrl: z.string().url().max(500).nullable().optional(),
};
const localizedBranchInput = z.object({
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  ...optionalBranchDetails,
});
const legacyBranchInput = z.object({ name: z.string().trim().min(2).max(100), ...optionalBranchDetails });
const branchNameUpdateInput = z.object({ id: z.string().uuid(), nameAr: z.string().trim().min(2).max(100), nameEn: z.string().trim().min(2).max(100) });
const containsArabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, undefined, { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  const branchIds = await getAccessibleBranchIds(access.context);
  const rows = branchIds.length ? await access.context.db.select().from(branches)
    .where(and(eq(branches.tenantId, access.context.tenantId), inArray(branches.id, branchIds)))
    .orderBy(asc(branches.nameAr)) : [];
  return Response.json({ branches: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  try {
    const body: unknown = await request.json();
    const localized = localizedBranchInput.safeParse(body);
    const id = crypto.randomUUID();
    let nameAr: string;
    let nameEn: string;
    let address: string | null | undefined;
    let phone: string | null | undefined;
    let mapUrl: string | null | undefined;
    if (localized.success) {
      ({ nameAr, nameEn, address, phone, mapUrl } = localized.data);
    } else {
      const legacy = legacyBranchInput.safeParse(body);
      if (!legacy.success) throw new ApiError("أدخل اسم الفرع بالعربية والإنجليزية وراجع بياناته");
      ({ name: nameAr, address, phone, mapUrl } = legacy.data);
      nameEn = containsArabic.test(nameAr) ? `Branch ${id}` : nameAr;
    }
    const [branchCountRow] = await access.context.db.select({ value: count() }).from(branches).where(eq(branches.tenantId, access.context.tenantId));
    const branchLimit = await getTenantResourceLimit(access.context.db, access.context.tenantId, "branch");
    if (branchLimit !== null && (branchCountRow?.value ?? 0) >= branchLimit) throw new ApiError("وصلت إلى الحد الحالي للفروع. اطلب فرعاً إضافياً من صفحة الفوترة بعد اعتماد التحويل.", 409);
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      access.context.db.insert(branches).values({ id, tenantId: access.context.tenantId, name: nameAr, nameAr, nameEn, address: address ?? null, phone: phone ?? null, mapUrl: mapUrl ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() }),
      access.context.db.insert(branchMemberships).values({ id: crypto.randomUUID(), tenantId: access.context.tenantId, userId: access.context.user.id, branchId: id, createdAt: new Date() }),
    ];
    await access.context.db.batch(statements);
    const [created] = await access.context.db.select().from(branches).where(and(eq(branches.id, id), eq(branches.tenantId, access.context.tenantId))).limit(1);
    await writeAudit(access.context, request, "branch.created", "branch", id, { nameAr, nameEn });
    return Response.json({ branch: created }, { status: 201 });
  } catch (error) {
    if (["branches_tenant_name_uq", "branches_tenant_name_ar_uq", "branches_tenant_name_en_uq"].some((index) => String(error).includes(index))) return Response.json({ error: "يوجد فرع بهذا الاسم في مساحة العمل" }, { status: 409 });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = branchNameUpdateInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("أدخل اسم الفرع بالعربية والإنجليزية");
    const input = parsed.data;
    const accessibleIds = await getAccessibleBranchIds(access.context);
    if (!accessibleIds.includes(input.id)) throw new ApiError("الفرع غير متاح لهذا المستخدم", 404);
    const [updated] = await access.context.db.update(branches)
      .set({ name: input.nameAr, nameAr: input.nameAr, nameEn: input.nameEn, updatedAt: new Date() })
      .where(and(eq(branches.id, input.id), eq(branches.tenantId, access.context.tenantId)))
      .returning();
    if (!updated) throw new ApiError("الفرع غير موجود", 404);
    await writeAudit(access.context, request, "branch.names_updated", "branch", input.id, { nameAr: input.nameAr, nameEn: input.nameEn });
    return Response.json({ branch: updated });
  } catch (error) {
    if (["branches_tenant_name_uq", "branches_tenant_name_ar_uq", "branches_tenant_name_en_uq"].some((index) => String(error).includes(index))) return Response.json({ error: "يوجد فرع بهذا الاسم في مساحة العمل" }, { status: 409 });
    return errorResponse(error);
  }
}
