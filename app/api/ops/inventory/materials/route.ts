import { z } from "zod";
import { inventoryItems, inventoryWarehouses, serviceMaterials, services } from "@/lib/db/schema";
import { quantityToUnits } from "@/lib/operations/inventory";
import { uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { and, eq } from "drizzle-orm";
import { requireAllActiveBranchMemberships, requireBranchMembership, requireWarehouseBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const inputSchema = z.object({ serviceId: uuidSchema, itemId: uuidSchema, warehouseId: uuidSchema, quantityPerService: z.number().finite().gt(0).max(100_000) });

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  await requireAllActiveBranchMemberships(access.context);
  const serviceId = new URL(request.url).searchParams.get("serviceId");
  const results = await access.context.env.DB.prepare(`SELECT sm.id, sm.service_id AS serviceId, s.name AS serviceName, sm.item_id AS itemId, i.sku, i.name AS itemName, sm.warehouse_id AS warehouseId, w.name AS warehouseName, sm.quantity_per_service AS quantityPerServiceUnits, i.quantity_scale AS quantityScale, i.unit_code AS unitCode, sm.is_active AS isActive, sm.created_at AS createdAt FROM service_materials sm JOIN services s ON s.id = sm.service_id AND s.tenant_id = sm.tenant_id JOIN inventory_items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id LEFT JOIN inventory_warehouses w ON w.id = sm.warehouse_id AND w.tenant_id = sm.tenant_id WHERE sm.tenant_id = ? AND sm.is_active = 1 ${serviceId ? "AND sm.service_id = ?" : ""} ORDER BY s.name, i.name LIMIT 500`)
    .bind(...(serviceId ? [access.context.tenantId, serviceId] : [access.context.tenantId])).all();
  return Response.json({ materials: results.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    await requireAllActiveBranchMemberships(access.context);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من الخدمة والصنف والكمية المستهلكة");
    const input = parsed.data;
    const [service] = await access.context.db.select({ id: services.id, branchId: services.branchId }).from(services).where(and(eq(services.id, input.serviceId), eq(services.tenantId, access.context.tenantId), eq(services.isActive, true))).limit(1);
    const [item] = await access.context.db.select({ id: inventoryItems.id, quantityScale: inventoryItems.quantityScale }).from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.tenantId, access.context.tenantId), eq(inventoryItems.isActive, true))).limit(1);
    const [warehouse] = await access.context.db.select({ id: inventoryWarehouses.id, isActive: inventoryWarehouses.isActive, branchId: inventoryWarehouses.branchId }).from(inventoryWarehouses).where(and(eq(inventoryWarehouses.id, input.warehouseId), eq(inventoryWarehouses.tenantId, access.context.tenantId))).limit(1);
    if (!service || !item || !warehouse?.isActive) throw new ApiError("الخدمة أو الصنف أو المخزن غير موجود أو غير نشط في مساحة العمل", 404);
    if (service.branchId && warehouse.branchId && service.branchId !== warehouse.branchId) throw new ApiError("لا يمكن ربط خدمة بمخزن فرع آخر", 409);
    const quantityPerService = quantityToUnits(input.quantityPerService, item.quantityScale);
    const existing = await access.context.db.select({ id: serviceMaterials.id }).from(serviceMaterials).where(and(eq(serviceMaterials.tenantId, access.context.tenantId), eq(serviceMaterials.serviceId, input.serviceId), eq(serviceMaterials.itemId, input.itemId))).limit(1);
    const id = existing[0]?.id ?? crypto.randomUUID();
    if (existing[0]) await access.context.db.update(serviceMaterials).set({ warehouseId: input.warehouseId, quantityPerService, isActive: true, updatedAt: new Date() }).where(and(eq(serviceMaterials.id, id), eq(serviceMaterials.tenantId, access.context.tenantId)));
    else await access.context.db.insert(serviceMaterials).values({ id, tenantId: access.context.tenantId, serviceId: input.serviceId, itemId: input.itemId, warehouseId: input.warehouseId, quantityPerService, isActive: true, createdAt: new Date(), updatedAt: new Date() });
    await writeAudit(access.context, request, "inventory.service_material_saved", "service_material", id, { serviceId: input.serviceId, itemId: input.itemId });
    return Response.json({ id }, { status: existing[0] ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  await requireAllActiveBranchMemberships(access.context);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !uuidSchema.safeParse(id).success) return Response.json({ error: "معرف ربط المواد غير صالح" }, { status: 400 });
  const [existing] = await access.context.db.select({ serviceBranchId: services.branchId, warehouseBranchId: inventoryWarehouses.branchId }).from(serviceMaterials).innerJoin(services, and(eq(services.id, serviceMaterials.serviceId), eq(services.tenantId, serviceMaterials.tenantId))).innerJoin(inventoryWarehouses, and(eq(inventoryWarehouses.id, serviceMaterials.warehouseId), eq(inventoryWarehouses.tenantId, serviceMaterials.tenantId))).where(and(eq(serviceMaterials.id, id), eq(serviceMaterials.tenantId, access.context.tenantId))).limit(1);
  if (!existing) return Response.json({ error: "ربط المواد غير موجود" }, { status: 404 });
  if (existing.serviceBranchId) await requireBranchMembership(access.context, existing.serviceBranchId);
  else await requireAllActiveBranchMemberships(access.context);
  await requireWarehouseBranchMembership(access.context, existing.warehouseBranchId);
  const [removed] = await access.context.db.update(serviceMaterials).set({ isActive: false, updatedAt: new Date() }).where(and(eq(serviceMaterials.id, id), eq(serviceMaterials.tenantId, access.context.tenantId), eq(serviceMaterials.isActive, true))).returning({ id: serviceMaterials.id });
  if (!removed) return Response.json({ error: "ربط المواد غير موجود" }, { status: 404 });
  await writeAudit(access.context, request, "inventory.service_material_disabled", "service_material", id);
  return Response.json({ disabled: true });
}
