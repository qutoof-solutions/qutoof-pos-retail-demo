import { and, eq } from "drizzle-orm";
import { quotationItems, quotations } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { POST as createInvoice } from "@/app/api/ops/invoices/route";

export const runtime = "edge";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("عرض السعر غير موجود", 404);
    const { db, tenantId } = access.context;
    const [quote] = await db.select().from(quotations).where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId))).limit(1);
    if (!quote) throw new ApiError("عرض السعر غير موجود", 404);
    if (quote.status === "cancelled" || quote.status === "expired") throw new ApiError("لا يمكن تحويل عرض ملغي أو منتهي", 409);
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
      await db.update(quotations).set({ status: "expired", updatedAt: new Date() }).where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId), eq(quotations.status, "issued")));
      throw new ApiError("انتهت صلاحية عرض السعر؛ أنشئ عرضًا جديدًا", 409);
    }
    await requireBranchMembership(access.context, quote.branchId);
    const lines = await db.select().from(quotationItems).where(and(eq(quotationItems.tenantId, tenantId), eq(quotationItems.quotationId, id))).orderBy(quotationItems.createdAt);
    if (!lines.length) throw new ApiError("عرض السعر لا يحتوي بنودًا", 409);
    const invoiceItems = lines.map((line) => line.serviceId
      ? { type: "service", quotationItemId: line.id, serviceId: line.serviceId, providerId: null, quantity: line.quantity }
      : { type: "inventory", quotationItemId: line.id, inventoryItemId: line.inventoryItemId, warehouseId: line.warehouseId, unitId: line.unitId ?? undefined, quantity: line.unitId && line.unitConversionFactor ? line.quantity / line.unitConversionFactor : line.quantity / (10 ** line.quantityScale), priceTier: line.priceTier });
    if (invoiceItems.some((line) => line.type === "inventory" && (!line.inventoryItemId || !line.warehouseId))) throw new ApiError("مخزن أحد أصناف العرض لم يعد صالحًا؛ راجع العرض وأصدر نسخة جديدة", 409);
    const payload = {
      quotationId: quote.id,
      idempotencyKey: `quotation-convert:${quote.id}`,
      branchId: quote.branchId,
      customerId: quote.customerId,
      discount: quote.discountMinor / 100,
      items: invoiceItems,
      payments: [],
      orderType: "counter",
    };
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    const invoiceRequest = new Request(new URL("/api/ops/invoices", request.url), { method: "POST", headers, body: JSON.stringify(payload) });
    const invoiceResponse = await createInvoice(invoiceRequest);
    const responseBody = await invoiceResponse.json() as { invoice?: { id: string; invoiceNumber?: string }; error?: string };
    if (!invoiceResponse.ok || !responseBody.invoice?.id) return Response.json(responseBody, { status: invoiceResponse.status });
    await db.update(quotations).set({ status: "converted", convertedInvoiceId: responseBody.invoice.id, updatedAt: new Date() }).where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId), eq(quotations.status, "issued")));
    await writeAudit(access.context, request, "quotation.converted", "quotation", id, { invoiceId: responseBody.invoice.id, invoiceNumber: responseBody.invoice.invoiceNumber });
    return Response.json({ ...responseBody, quotationId: id }, { status: invoiceResponse.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
