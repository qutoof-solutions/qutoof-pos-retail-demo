export type TenantOnboardingState = {
  required: boolean;
  version: number;
  completedAt: string | null;
};

type JsonObject = Record<string, unknown>;

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

export function readTenantOnboardingState(value: string): TenantOnboardingState {
  const onboarding = parseJsonObject(value).onboarding;
  if (!onboarding || typeof onboarding !== "object" || Array.isArray(onboarding)) {
    return { required: false, version: 0, completedAt: null };
  }
  const state = onboarding as JsonObject;
  return {
    required: state.required === true,
    version: typeof state.version === "number" && Number.isInteger(state.version) ? state.version : 0,
    completedAt: typeof state.completedAt === "string" ? state.completedAt : null,
  };
}

export function writeTenantOnboardingState(value: string, state: TenantOnboardingState): string {
  const settings = parseJsonObject(value);
  return JSON.stringify({
    ...settings,
    onboarding: {
      required: state.required,
      version: state.version,
      completedAt: state.completedAt,
    },
  });
}

export function isTenantOnboardingComplete(value: string): boolean {
  const state = readTenantOnboardingState(value);
  return !state.required || state.completedAt !== null;
}

export function canUseOnboardingSetup(value: string, role: string, tenantStatus: string): boolean {
  const state = readTenantOnboardingState(value);
  return (role === "business_admin" || role === "owner") && (tenantStatus === "pending_trial" || tenantStatus === "active_trial") && state.required && state.completedAt === null;
}
