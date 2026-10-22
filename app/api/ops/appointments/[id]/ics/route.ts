import { PRODUCT_NAME } from "@/lib/brand";
import { and, eq } from "drizzle-orm";
import { appointments, branches, customers, services } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
type RouteContext = { params: Promise<{ id: string }> };
function icsEscape(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n"); }
function icsDate(value: Date): string { return value.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z"); }

export async function GET(request: Request, route: RouteContext): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin", "reception", "provider"]);
  if (!access.ok) return access.response;
  try {
    const { id } = await route.params;
    const [row] = await access.context.db.select({ appointment: appointments, customerName: customers.fullName, serviceName: services.name, branchName: branches.name }).from(appointments).innerJoin(customers, and(eq(customers.id, appointments.customerId), eq(customers.tenantId, access.context.tenantId))).innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, access.context.tenantId))).leftJoin(branches, and(eq(branches.id, appointments.branchId), eq(branches.tenantId, access.context.tenantId))).where(and(eq(appointments.id, id), eq(appointments.tenantId, access.context.tenantId))).limit(1);
    if (!row) throw new ApiError("الموعد غير موجود", 404);
    await requireBranchMembership(access.context, row.appointment.branchId);
    if (access.context.session.role === "doctor" || access.context.session.role === "specialist" || access.context.session.role === "provider") {
      if (row.appointment.providerId !== access.context.session.sub) throw new ApiError("لا تملك صلاحية هذا الموعد", 403);
    }
    const summary = `${row.serviceName} — ${row.customerName}`;
    const location = row.branchName ?? PRODUCT_NAME;
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${PRODUCT_NAME}//Appointments//AR`, "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${row.appointment.id}@qutoof-crm`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(row.appointment.startsAt)}`, `DTEND:${icsDate(row.appointment.endsAt)}`, `SUMMARY:${icsEscape(summary)}`, `LOCATION:${icsEscape(location)}`, row.appointment.notes ? `DESCRIPTION:${icsEscape(row.appointment.notes)}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n") + "\r\n";
    return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="appointment-${row.appointment.id}.ics"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
