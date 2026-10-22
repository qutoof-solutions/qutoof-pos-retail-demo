import { and, eq } from "drizzle-orm";
import { appointments, customers, patientRecords } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { z } from "zod";
import { isClinicalRole } from "@/lib/operations/permissions";
import { getCustomerBranchScope, requireBranchMembership } from "@/lib/server/branch-access";
import { MAX_MEDICAL_ATTACHMENT_BYTES, readRequestBodyLimited, validateMedicalAttachment } from "@/lib/records/attachments";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
const maxMultipartBytes = MAX_MEDICAL_ATTACHMENT_BYTES + 128 * 1024;

export async function POST(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "nurse"]);
  if (!access.ok) return access.response;
  try {
    const { id: customerId } = await route.params;
    if (!z.string().uuid().safeParse(customerId).success) throw new ApiError("معرف العميل غير صالح");
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const requestBytes = Number(contentLength);
      if (!Number.isSafeInteger(requestBytes) || requestBytes < 1 || requestBytes > maxMultipartBytes) throw new ApiError("حجم الطلب أكبر من الحد المسموح به");
    }
    const scope = await getCustomerBranchScope(access.context, customerId);
    const [customer] = await access.context.db.select({ id: customers.id, branchId: customers.branchId }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, access.context.tenantId))).limit(1);
    if (!customer) throw new ApiError("العميل غير موجود", 404);
    if (isClinicalRole(access.context.session.role)) {
      const ownVisit = await access.context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customerId), eq(appointments.providerId, access.context.session.sub))).limit(1);
      if (!ownVisit.length) throw new ApiError("لا تملك صلاحية رفع ملفات لهذا العميل", 403);
    }
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) throw new ApiError("يجب إرسال المرفق كنموذج multipart");
    const boundedBody = await readRequestBodyLimited(request, maxMultipartBytes);
    if (!boundedBody) throw new ApiError("حجم الطلب أكبر من الحد المسموح به أو أن الطلب فارغ");
    const formBody = new ArrayBuffer(boundedBody.byteLength);
    new Uint8Array(formBody).set(boundedBody);
    const formRequest = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: formBody });
    let form: FormData;
    try { form = await formRequest.formData(); }
    catch { throw new ApiError("صيغة multipart غير صالحة"); }
    const file = form.get("file");
    const title = String(form.get("title") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const appointmentIdValue = String(form.get("appointmentId") ?? "").trim();
    const appointmentId = appointmentIdValue || null;
    if (appointmentId) {
      const [visit] = await access.context.db.select({ id: appointments.id, branchId: appointments.branchId, providerId: appointments.providerId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customerId))).limit(1);
      if (!visit) throw new ApiError("الموعد المرتبط لا يخص هذا العميل", 404);
      await requireBranchMembership(access.context, visit.branchId);
      if (isClinicalRole(access.context.session.role) && visit.providerId !== access.context.session.sub) throw new ApiError("لا تملك صلاحية هذا الموعد", 403);
    } else if (!customer.branchId || !scope.accessibleBranchIds.includes(customer.branchId)) {
      throw new ApiError("اختر موعدًا في أحد الفروع المسندة لربط المرفق به", 400);
    }
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_MEDICAL_ATTACHMENT_BYTES || title.length < 2 || title.length > 160 || notes.length > 2000) throw new ApiError("ارفع PDF أو JPG أو PNG بحجم لا يتجاوز 10 ميغابايت، واكتب ملاحظات لا تتجاوز 2000 حرف");
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const validatedFile = validateMedicalAttachment({ fileName: file.name, declaredType: file.type, size: file.size, bytes: fileBytes });
    if (!validatedFile) throw new ApiError("امتداد الملف أو نوعه أو محتواه غير مدعوم؛ المسموح PDF وJPG وPNG فقط");
    const key = `${access.context.tenantId}/${customerId}/${crypto.randomUUID()}.${validatedFile.extension}`;
    await access.context.env.FILES.put(key, fileBytes, { httpMetadata: { contentType: validatedFile.contentType, cacheControl: "private, no-store" }, customMetadata: { tenantId: access.context.tenantId, customerId, originalFileName: validatedFile.safeFileName } });
    const id = crypto.randomUUID();
    try {
      const [record] = await access.context.db.insert(patientRecords).values({ id, tenantId: access.context.tenantId, customerId, appointmentId, authorId: access.context.user.id, recordType: "attachment", title, body: notes || null, attachmentKey: key, metadataJson: JSON.stringify({ fileName: validatedFile.safeFileName, contentType: validatedFile.contentType, size: file.size }), createdAt: new Date(), updatedAt: new Date() }).returning();
      await writeAudit(access.context, request, "patient_record.attachment", "patient_record", id, { customerId, size: file.size });
      return Response.json({ record: { id: record.id, customerId: record.customerId, appointmentId: record.appointmentId, recordType: record.recordType, title: record.title, body: record.body, metadataJson: record.metadataJson, createdAt: record.createdAt } }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      try { await access.context.db.delete(patientRecords).where(and(eq(patientRecords.id, id), eq(patientRecords.tenantId, access.context.tenantId))); } catch { /* Keep the original write failure. */ }
      await access.context.env.FILES.delete(key).catch(() => undefined);
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
