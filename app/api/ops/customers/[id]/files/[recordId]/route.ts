import { and, eq } from "drizzle-orm";
import { appointments, patientRecords } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { isClinicalRole } from "@/lib/operations/permissions";
import { getCustomerBranchScope, requireBranchMembership } from "@/lib/server/branch-access";
import { sanitizeMedicalFileName } from "@/lib/records/attachments";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string; recordId: string }> };
interface StoredObject { body: ReadableStream; httpMetadata?: { contentType?: string }; size: number }

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "provider", "nurse"]);
  if (!access.ok) return access.response;
  try {
  const { id: customerId, recordId } = await route.params;
  const scope = await getCustomerBranchScope(access.context, customerId);
  const [record] = await access.context.db.select().from(patientRecords).where(and(eq(patientRecords.id, recordId), eq(patientRecords.customerId, customerId), eq(patientRecords.tenantId, access.context.tenantId))).limit(1);
  if (!record || !record.attachmentKey) throw new ApiError("الملف غير موجود", 404);
  if (record.appointmentId) {
    if (!scope.appointmentIds.includes(record.appointmentId)) throw new ApiError("لا تملك صلاحية الوصول إلى هذا الملف", 403);
    const [visit] = await access.context.db.select({ branchId: appointments.branchId }).from(appointments).where(and(eq(appointments.id, record.appointmentId), eq(appointments.tenantId, access.context.tenantId))).limit(1);
    await requireBranchMembership(access.context, visit?.branchId);
  } else if (!scope.customerBranchId || !scope.accessibleBranchIds.includes(scope.customerBranchId)) {
    throw new ApiError("لا تملك صلاحية الوصول إلى هذا الملف", 403);
  }
  if (isClinicalRole(access.context.session.role)) {
    const isAuthor = record.authorId === access.context.session.sub;
    const visit = record.appointmentId ? await access.context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, record.appointmentId), eq(appointments.tenantId, access.context.tenantId), eq(appointments.customerId, customerId), eq(appointments.providerId, access.context.session.sub))).limit(1) : [];
    if (!visit.length && !isAuthor) throw new ApiError("لا تملك صلاحية الوصول إلى هذا الملف", 403);
  }
  const object = await access.context.env.FILES.get(record.attachmentKey) as StoredObject | null;
  if (!object) return Response.json({ error: "الملف غير موجود في التخزين" }, { status: 404 });
  let metadata: { fileName?: unknown } = {};
  try { metadata = JSON.parse(record.metadataJson) as { fileName?: unknown }; } catch { /* Older rows may not contain file metadata. */ }
  const extension = object.httpMetadata?.contentType === "application/pdf" ? ".pdf" : object.httpMetadata?.contentType === "image/png" ? ".png" : object.httpMetadata?.contentType === "image/jpeg" ? ".jpg" : "";
  const fallbackFileName = `${record.title}${extension}`;
  const fileName = sanitizeMedicalFileName(typeof metadata.fileName === "string" ? metadata.fileName : fallbackFileName);
  const encodedFileName = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream", "Content-Length": String(object.size), "Content-Disposition": `${disposition}; filename="medical-attachment"; filename*=UTF-8''${encodedFileName}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
  } catch (error) { return errorResponse(error); }
}
