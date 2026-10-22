import { z } from "zod";
import { suppliers } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { getAccessibleWarehouseIds, requireAllActiveBranchMemberships } from "@/lib/server/branch-access";

export const runtime = "edge";
const supplierInput = z.object({ name: z.string().trim().min(2).max(120), contactName: z.string().trim().max(120).nullable().optional(), phone: z.string().trim().max(32).nullable().optional(), email: z.string().trim().email().max(254).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), taxNumber: z.string().trim().max(80).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  const warehouseIds = await getAccessibleWarehouseIds(access.context);
  if (!warehouseIds.length) return Response.json({ suppliers: [] }, { headers: { "Cache-Control": "no-store" } });
  const placeholders = warehouseIds.map(() => "?").join(",");
  const result = await access.context.env.DB.prepare(`SELECT s.id, s.name, s.contact_name AS contactName, s.phone, s.email, s.address, s.tax_number AS taxNumber, s.notes, s.is_active AS isActive, s.created_at AS createdAt, COALESCE(SUM(CASE WHEN p.status = 'received' THEN p.total_minor - p.paid_minor ELSE 0 END), 0) AS payableMinor FROM suppliers s LEFT JOIN purchase_invoices p ON p.tenant_id = s.tenant_id AND p.supplier_id = s.id AND p.warehouse_id IN (${placeholders}) WHERE s.tenant_id = ? GROUP BY s.id ORDER BY s.name LIMIT 300`).bind(...warehouseIds, access.context.tenantId).all();
  return Response.json({ suppliers: result.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "storekeeper"]);
  if (!access.ok) return access.response;
  try {
    await requireAllActiveBranchMemberships(access.context);
    const parsed = supplierInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من بيانات المورد ووسيلة التواصل");
    const input = parsed.data;
    const id = crypto.randomUUID();
    const [supplier] = await access.context.db.insert(suppliers).values({ id, tenantId: access.context.tenantId, name: input.name, contactName: input.contactName ?? null, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, address: input.address ?? null, taxNumber: input.taxNumber ?? null, notes: input.notes ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
    await writeAudit(access.context, request, "supplier.created", "supplier", id);
    return Response.json({ supplier }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
