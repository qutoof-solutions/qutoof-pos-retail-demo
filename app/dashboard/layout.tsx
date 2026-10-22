import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Banknote, CalendarDays, Clock3, CreditCard, FileSpreadsheet, FileText, Globe2, LayoutDashboard, MapPinned, MessageCircle, MonitorPlay, PackageOpen, ShieldCheck, UsersRound, WalletCards, ChartNoAxesCombined, Truck, Landmark, type LucideIcon } from "lucide-react";
import { BillingPanel } from "@/components/platform/billing-panel";
import { ImpersonationBanner } from "@/components/platform/impersonation-banner";
import { operationalAccessAllowed } from "@/lib/platform/billing";
import { isFeatureEnabled, isPlanFeatureEnabled } from "@/lib/platform/features";
import { getPageContext } from "@/lib/server/page-access";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PageTransition } from "@/components/theme/page-transition";
import { OnboardingGate } from "@/components/operations/onboarding-gate";
import { readTenantOnboardingState } from "@/lib/operations/onboarding";
import { isOwnerRole, roleCanAccessDashboardRole } from "@/lib/operations/permissions";
import { PRODUCT_NAME } from "@/lib/brand";
import { DataLanguageToggle } from "@/components/operations/data-portability-ui";
import { DashboardLocaleShell } from "@/components/dashboard/dashboard-locale-shell";
import { MobileSidebarDrawer } from "@/components/dashboard/mobile-sidebar-drawer";
import { DashboardSidebarContent } from "@/components/dashboard/dashboard-sidebar-content";
import { DashboardBillingLink, DashboardGraceBanner, DashboardLogoutButton, DashboardStatusBadge, DashboardTenantMeta, DashboardTrialBanner } from "@/components/dashboard/dashboard-chrome";
import { getTranslations } from "next-intl/server";
import { getRemainingTrialDays } from "@/lib/i18n/trial-days";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type DashboardLink = { href: string; icon: LucideIcon; roles: string[]; entitlement?: string };
const allLinks: DashboardLink[] = [
  { href: "/dashboard", icon: LayoutDashboard, roles: ["business_admin", "reception", "provider"] },
  { href: "/dashboard/calendar", icon: CalendarDays, roles: ["business_admin", "reception", "provider"] },
  { href: "/dashboard/customers", icon: UsersRound, roles: ["business_admin", "reception", "provider", "nurse"] },
  { href: "/dashboard/services", icon: PackageOpen, roles: ["business_admin"] },
  { href: "/dashboard/schedules", icon: Clock3, roles: ["business_admin"] },
  { href: "/dashboard/attendance", icon: Clock3, roles: ["business_admin", "reception", "provider", "nurse", "storekeeper"] },
  { href: "/dashboard/branches", icon: MapPinned, roles: ["business_admin"], entitlement: "branches" },
  { href: "/dashboard/queue", icon: MonitorPlay, roles: ["business_admin", "reception", "provider"], entitlement: "queue" },
  { href: "/dashboard/gate", icon: ShieldCheck, roles: ["business_admin", "reception"] },
  { href: "/dashboard/pos", icon: FileText, roles: ["business_admin", "reception"], entitlement: "pos" },
  { href: "/dashboard/installments", icon: CreditCard, roles: ["business_admin"], entitlement: "reports" },
  { href: "/dashboard/commissions", icon: WalletCards, roles: ["business_admin"], entitlement: "reports" },
  { href: "/dashboard/medical-tools", icon: ShieldCheck, roles: ["business_admin", "provider", "doctor", "specialist"], entitlement: "reports" },
  { href: "/dashboard/reports", icon: ChartNoAxesCombined, roles: ["business_admin"], entitlement: "reports" },
  { href: "/dashboard/public-booking", icon: Globe2, roles: ["business_admin"], entitlement: "public_booking" },
  { href: "/dashboard/whatsapp", icon: MessageCircle, roles: ["business_admin"] },
  { href: "/dashboard/billing", icon: CreditCard, roles: ["business_admin"] },
  { href: "/dashboard/team", icon: UsersRound, roles: ["business_admin"] },
  { href: "/dashboard/inventory", icon: PackageOpen, roles: ["business_admin", "storekeeper"] },
  { href: "/dashboard/suppliers", icon: UsersRound, roles: ["business_admin", "storekeeper"] },
  { href: "/dashboard/purchases", icon: FileText, roles: ["business_admin", "storekeeper"] },
  { href: "/dashboard/cheques", icon: Banknote, roles: ["business_admin", "reception", "storekeeper"] },
  { href: "/dashboard/movements", icon: PackageOpen, roles: ["business_admin", "storekeeper"] },
  { href: "/dashboard/service-materials", icon: PackageOpen, roles: ["business_admin"] },
  { href: "/dashboard/distribution", icon: Truck, roles: ["business_admin", "storekeeper"], entitlement: "warehouse" },
  { href: "/dashboard/treasury", icon: Landmark, roles: ["business_admin"], entitlement: "reports" },
  { href: "/dashboard/data-import", icon: FileSpreadsheet, roles: ["business_admin", "storekeeper", "reception"] },
];

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getPageContext();
  const tChrome = await getTranslations("dashboardChrome");
  const roleTranslations: Record<string, string> = { business_admin: tChrome("roles.business_admin"), owner: tChrome("roles.owner"), admin: tChrome("roles.business_admin"), reception: tChrome("roles.reception"), receptionist: tChrome("roles.reception"), provider: tChrome("roles.provider"), doctor: tChrome("roles.doctor"), specialist: tChrome("roles.specialist"), storekeeper: tChrome("roles.storekeeper"), nurse: tChrome("roles.nurse") };
  const ownerOnlyLinks = new Set(["/dashboard/team", "/dashboard/whatsapp"]);
  const roleLinks = allLinks.filter((item) => roleCanAccessDashboardRole(context.session.role, item.roles) && (!ownerOnlyLinks.has(item.href) || isOwnerRole(context.session.role)));
  const entitlementKeys = [...new Set(roleLinks.flatMap((item) => item.entitlement ? [item.entitlement] : []))];
  const entitlementPairs = await Promise.all(entitlementKeys.map(async (key) => {
    const [planAllowed, globalAllowed] = await Promise.all([
      isPlanFeatureEnabled(context.db, context.tenant.platformPlanId, key),
      key === "public_booking" || key === "whatsapp" ? isFeatureEnabled(context.db, key, true) : Promise.resolve(true),
    ]);
    return [key, planAllowed && globalAllowed] as const;
  }));
  const entitlements = Object.fromEntries(entitlementPairs);
  const links = roleLinks.filter((item) => !item.entitlement || entitlements[item.entitlement]);
  const canOperate = operationalAccessAllowed(context.tenant.status);
  const canManageBilling = isOwnerRole(context.session.role);
  const onboardingState = readTenantOnboardingState(context.tenant.settingsJson);
  const needsOnboarding = canManageBilling && onboardingState.required && !onboardingState.completedAt;
  const sidebarLinks = links.map(({ href }) => ({ href }));
  const roleName = roleTranslations[context.session.role] ?? context.session.role;
  const sidebarContent = <DashboardSidebarContent links={sidebarLinks} userName={context.user.fullName} role={context.session.role} tenantName={context.tenant.name} />;
  if (!canOperate && !needsOnboarding) return <DashboardLocaleShell showWidget><div className="dashboard-shell min-h-screen min-w-0 overflow-x-hidden bg-canvas">
    {context.session.impersonationId && <ImpersonationBanner tenantName={context.tenant.name} />}
    <header className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <MobileSidebarDrawer>
          <div className="flex min-h-full flex-col">
            <Link href="/dashboard" className="flex items-center justify-center border-b border-white/10 pb-5" aria-label={PRODUCT_NAME}><BrandLogo variant="dark" className="h-16 w-16 object-contain" /></Link>
            <div className="flex-1" />
            <div className="border-t border-white/10 pt-4"><strong className="block truncate text-sm text-white">{context.user.fullName}</strong><span className="mt-1 block truncate text-xs text-slate-400">{roleName} · {context.tenant.name}</span><div className="mt-3"><DashboardLogoutButton dark /></div></div>
          </div>
        </MobileSidebarDrawer>
        <Link href="/dashboard" className="inline-flex items-center" aria-label={PRODUCT_NAME}><BrandLogo className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14" /></Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DataLanguageToggle compact />
        <ThemeToggle />
        <div className="hidden md:block"><DashboardLogoutButton /></div>
      </div>
    </header>
    <BillingPanel canManage={canManageBilling} initialStatus={context.tenant.status} />
  </div></DashboardLocaleShell>;

  return <DashboardLocaleShell showWidget><div className="dashboard-shell min-h-screen min-w-0 overflow-x-hidden bg-canvas">
    {context.session.impersonationId && <ImpersonationBanner tenantName={context.tenant.name} />}
    <aside className="dashboard-sidebar fixed inset-y-0 z-20 hidden w-72 flex-col bg-navy p-5 text-white shadow-2xl md:flex">{sidebarContent}</aside>
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-4 sm:py-3 lg:hidden">
      <div className="flex min-w-0 items-center gap-3"><MobileSidebarDrawer>{sidebarContent}</MobileSidebarDrawer><Link href="/dashboard" className="inline-flex items-center" aria-label={PRODUCT_NAME}><BrandLogo className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14" /></Link></div>
      <div className="flex shrink-0 items-center gap-2"><DataLanguageToggle compact /><ThemeToggle /><div className="hidden md:block"><DashboardLogoutButton /></div></div>
    </header>
    <main className="dashboard-main min-h-screen min-w-0 overflow-x-hidden"><header className="hidden items-center justify-between border-b border-slate-200 bg-white px-8 py-5 lg:flex"><div><p className="text-sm text-muted">{context.tenant.name}</p><DashboardTenantMeta timezone={context.tenant.timezone} /></div><div className="flex items-center gap-3"><DataLanguageToggle /><ThemeToggle />{canManageBilling && <DashboardBillingLink />}<DashboardStatusBadge status={context.tenant.status} role={context.session.role} /></div></header>
      <div className="min-w-0 overflow-x-hidden p-4 pb-8 sm:p-6 lg:p-8">{context.tenant.status === "grace" && canManageBilling && <DashboardGraceBanner canManageBilling={canManageBilling} endsAt={context.tenant.subscriptionEndsAt} />}{context.tenant.status === "active_trial" && canManageBilling && <DashboardTrialBanner endsAt={context.tenant.trialEndsAt} daysRemaining={getRemainingTrialDays(context.tenant.trialEndsAt)} />}<OnboardingGate required={needsOnboarding}><PageTransition>{children}</PageTransition></OnboardingGate></div>
    </main>
  </div></DashboardLocaleShell>;
}
