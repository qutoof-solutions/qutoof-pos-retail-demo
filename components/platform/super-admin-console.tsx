"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, Building2, CreditCard, Flag, LayoutDashboard, Lightbulb, MessageCircle, ReceiptText, Settings2 } from "lucide-react";
import { OverviewPanel } from "@/components/platform/overview-panel";
import { TenantDirectory } from "@/components/platform/tenant-directory";
import { BillingReviewPanel } from "@/components/platform/billing-review-panel";
import { PlansPanel } from "@/components/platform/plans-panel";
import { PlatformSettingsPanel } from "@/components/platform/platform-settings-panel";
import { FeatureFlagsPanel } from "@/components/platform/feature-flags-panel";
import { AuditLogPanel } from "@/components/platform/audit-log-panel";
import { FeatureRequestsPanel } from "@/components/platform/feature-requests-panel";
import { SupportTicketsPanel } from "@/components/platform/support-tickets-panel";

const tabs = [
  { id: "overview", key: "tabs.overview", icon: LayoutDashboard },
  { id: "tenants", key: "tabs.tenants", icon: Building2 },
  { id: "billing", key: "tabs.billing", icon: ReceiptText },
  { id: "plans", key: "tabs.plans", icon: CreditCard },
  { id: "settings", key: "tabs.settings", icon: Settings2 },
  { id: "features", key: "tabs.features", icon: Flag },
  { id: "requests", key: "tabs.requests", icon: Lightbulb },
  { id: "support", key: "tabs.support", icon: MessageCircle },
  { id: "audit", key: "tabs.audit", icon: Activity },
] as const;
type TabId = (typeof tabs)[number]["id"];

export function SuperAdminConsole() {
  const locale = useLocale();
  const t = useTranslations("platformAdmin");
  const [active, setActive] = useState<TabId>("overview");
  return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">{tabs.map(({ id, key, icon: Icon }) => <button key={id} type="button" onClick={() => setActive(id)} aria-current={active === id ? "page" : undefined} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${active === id ? "bg-navy text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon size={17} />{t(key)}</button>)}</div>
    {active === "overview" && <OverviewPanel onOpenBilling={() => setActive("billing")} />}
    {active === "tenants" && <TenantDirectory />}
    {active === "billing" && <BillingReviewPanel />}
    {active === "plans" && <PlansPanel />}
    {active === "settings" && <PlatformSettingsPanel />}
    {active === "features" && <FeatureFlagsPanel />}
    {active === "requests" && <FeatureRequestsPanel />}
    {active === "support" && <SupportTicketsPanel />}
    {active === "audit" && <AuditLogPanel />}
  </div>;
}
