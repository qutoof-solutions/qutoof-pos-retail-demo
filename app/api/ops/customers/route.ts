import { and, asc, eq, exists, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers } from "@/lib/db/schema";
import { phoneSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { getAccessibleBranchIds, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const customerInput = z.object({ branchId: z.string().uuid(), priceTier: z.enum(["retail", "wholesale", "distributor"]).default("retail"), fullName: z.string().trim().min(2).max(120), phone: phoneSchema, email: z.string().trim().email().max(254).nullable().optional(), gender: z.enum(["female", "male", "unspecified"]).default("unspecified"), dateOfBirth: z.string().date().nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider", "nurse"]);
  if (!access.ok) return access.response;
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const requestedLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 50;
  const branchIds = await getAccessibleBranchIds(access.context);
  if (!branchIds.length) return Response.json({ customers: [] }, { headers: { "Cache-Control": "no-store" } });
  const filters = [eq(customers.tenantId, access.context.tenantId)];
  filters.push(or(inArray(customers.branchId, branchIds), exists(access.context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customers.id), inArray(appointments.branchId, branchIds)))))!);
  if (query) {
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    filters.push(or(like(customers.fullName, `%${escaped}%`), like(customers.phone, `%${escaped}%`))!);
  }
  if (isClinicalRole(access.context.session.role)) {
    filters.push(exists(access.context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customers.id), eq(appointments.providerId, access.context.session.sub)))));
  }
  const rows = await access.context.db.select({ id: customers.id, fullName: customers.fullName, phone: customers.phone, priceTier: customers.priceTier, email: customers.email, gender: customers.gender, dateOfBirth: customers.dateOfBirth, branchId: customers.branchId, createdAt: customers.createdAt }).from(customers).where(and(...filters)).orderBy(asc(customers.fullName)).limit(limit);
  return Response.json({ customers: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const parsed = customerInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات العميل ورقم الهاتف");
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const id = crypto.randomUUID();
    const [created] = await access.context.db.insert(customers).values({ id, tenantId: access.context.tenantId, branchId: input.branchId, priceTier: input.priceTier, fullName: input.fullName, phone: input.phone, email: input.email ?? null, gender: input.gender, dateOfBirth: input.dateOfBirth ?? null, notes: input.notes ?? null, createdAt: new Date(), updatedAt: new Date() }).returning({ id: customers.id, fullName: customers.fullName, phone: customers.phone, priceTier: customers.priceTier, email: customers.email, gender: customers.gender, dateOfBirth: customers.dateOfBirth });
    await writeAudit(access.context, request, "customer.created", "customer", id);
    return Response.json({ customer: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
