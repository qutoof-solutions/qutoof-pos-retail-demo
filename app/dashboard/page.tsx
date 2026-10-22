import { redirect } from "next/navigation";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { appointments, customers, shiftSettlements, services, schedules, tenantPublicProfiles } from "@/lib/db/schema";
import { getPageContext } from "@/lib/server/page-access";
import { getTerms } from "@/lib/terms";
import { isBusinessAdminRole, roleCanAccessDashboardRole } from "@/lib/operations/permissions";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { getServerLocale } from "@/lib/i18n/server-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await getPageContext();
  const locale = await getServerLocale();
  if (context.session.role === "nurse") redirect("/dashboard/customers");
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(start.getTime() + 86_400_000);
  const [appointmentCount, customerCount, activeShiftCount, serviceCount, scheduleCount, profileRows] = await Promise.all([
    context.db.select({ value: count() }).from(appointments).where(eq(appointments.tenantId, context.tenantId)),
    context.db.select({ value: count() }).from(customers).where(eq(customers.tenantId, context.tenantId)),
    context.db.select({ value: count() }).from(shiftSettlements).where(and(eq(shiftSettlements.tenantId, context.tenantId), eq(shiftSettlements.status, "open"))),
    context.db.select({ value: count() }).from(services).where(and(eq(services.tenantId, context.tenantId), eq(services.isActive, true))),
    context.db.select({ value: count() }).from(schedules).where(and(eq(schedules.tenantId, context.tenantId), eq(schedules.isAvailable, true))),
    context.db.select().from(tenantPublicProfiles).where(eq(tenantPublicProfiles.tenantId, context.tenantId)).limit(1),
  ]);
  const todayAppointments = await context.db.select({ value: count() }).from(appointments).where(and(eq(appointments.tenantId, context.tenantId), gte(appointments.startsAt, start), lt(appointments.startsAt, tomorrow)));
  const terms = getTerms(context.tenant.vertical);
  const formatter = new Intl.NumberFormat(locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn");
  const cards = [
    { labelKey: "dashboard.appointmentsToday", value: formatter.format(todayAppointments[0]?.value ?? 0), kind: "appointment" as const, href: "/dashboard/calendar" },
    { labelKey: "dashboard.customers", value: formatter.format(customerCount[0]?.value ?? 0), kind: "customer" as const, href: "/dashboard/customers" },
    { labelKey: "dashboard.openShifts", value: formatter.format(activeShiftCount[0]?.value ?? 0), kind: "shift" as const, href: "/dashboard/pos" },
    { labelKey: "dashboard.totalAppointments", value: formatter.format(appointmentCount[0]?.value ?? 0), kind: "total" as const, href: "/dashboard/calendar" },
  ];
  const profile = profileRows[0];
  const setupSteps = [
    { titleKey: "dashboard.addService", done: (serviceCount[0]?.value ?? 0) > 0, href: "/dashboard/services" },
    { titleKey: "dashboard.workingHours", done: (scheduleCount[0]?.value ?? 0) > 0, href: "/dashboard/schedules" },
    { titleKey: "dashboard.publicBooking", done: Boolean(profile?.bookingEnabled), href: "/dashboard/public-booking" },
  ];
  const setupDone = setupSteps.filter((step) => step.done).length;
  const paymentReady = Boolean(profile && (profile.mobileWalletNumber.trim() || profile.instapayLink.trim() || profile.instapayQrUrl.trim()));
  const allowedCards = cards.filter((card) => card.href !== "/dashboard/pos" || roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception"]));
  const landingHref = roleCanAccessDashboardRole(context.session.role, ["storekeeper"]) && !roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception", "provider"]) ? "/dashboard/inventory" : "/dashboard/calendar";
  return <DashboardOverview fullName={context.user.fullName} tenantName={context.tenant.name} customerTerm={terms.customer} cards={allowedCards} setupSteps={setupSteps} setupDone={setupDone} paymentReady={paymentReady} landingHref={landingHref} canManageSetup={isBusinessAdminRole(context.session.role)} canOpenCustomers={roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception", "provider"])} canOpenQueue={roleCanAccessDashboardRole(context.session.role, ["business_admin", "reception"])} />;
}
