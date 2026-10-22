import type { AuthRole } from "@/lib/auth";

/**
 * Compatibility boundary for legacy role names. New roles are additive; existing
 * database values are never renamed or implicitly upgraded.
 */
const LEGACY_ROLE_ALIASES: Record<string, readonly AuthRole[]> = {
  business_admin: ["business_admin", "owner", "admin"],
  reception: ["reception", "receptionist"],
  provider: ["provider", "doctor", "specialist"],
  storekeeper: ["storekeeper"],
  super_admin: ["super_admin"],
};

export function roleMatchesAny(role: AuthRole, allowedRoles: readonly AuthRole[]): boolean {
  return allowedRoles.some((allowed) => (LEGACY_ROLE_ALIASES[allowed] ?? [allowed]).includes(role));
}

export function isOwnerRole(role: AuthRole): boolean {
  return role === "business_admin" || role === "owner";
}

export function isBusinessAdminRole(role: AuthRole): boolean {
  return isOwnerRole(role) || role === "admin";
}

export function isFrontDeskRole(role: AuthRole): boolean {
  return role === "reception" || role === "receptionist";
}

export function isClinicalRole(role: AuthRole): boolean {
  return role === "provider" || role === "doctor" || role === "specialist";
}

export function isNursingRole(role: AuthRole): boolean {
  return role === "nurse";
}

/** ADMIN follows the tenant-admin surface but does not control subscription ownership or WhatsApp credentials. */
export function isRoleAllowedForOperation(role: AuthRole, allowedRoles: readonly AuthRole[], pathname: string): boolean {
  if (!roleMatchesAny(role, allowedRoles)) return false;
  if (role === "admin" && (pathname.startsWith("/api/ops/billing") || pathname.startsWith("/api/ops/whatsapp") || pathname.startsWith("/api/ops/onboarding"))) return false;
  return true;
}

/** Central role-to-dashboard policy; API handlers remain the security boundary. */
export function roleCanAccessDashboardRole(role: AuthRole, dashboardRoles: readonly string[]): boolean {
  return roleMatchesAny(role, dashboardRoles as AuthRole[]);
}

export const STAFF_ASSIGNABLE_ROLES = ["admin", "receptionist", "doctor", "specialist", "storekeeper", "reception", "provider", "nurse"] as const satisfies readonly AuthRole[];
