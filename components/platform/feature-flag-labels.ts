export type FeatureFlagCopy = {
  label: "features.flags.maintenanceMode.label" | "features.flags.subscriptionBilling.label" | "features.flags.unknown.label";
  description: "features.flags.maintenanceMode.description" | "features.flags.subscriptionBilling.description" | "features.flags.unknown.description";
};

const FEATURE_FLAG_COPY: Record<string, FeatureFlagCopy> = {
  maintenance_mode: {
    label: "features.flags.maintenanceMode.label",
    description: "features.flags.maintenanceMode.description",
  },
  subscription_billing: {
    label: "features.flags.subscriptionBilling.label",
    description: "features.flags.subscriptionBilling.description",
  },
};

export function featureFlagCopy(key: string): FeatureFlagCopy {
  return FEATURE_FLAG_COPY[key] ?? {
    label: "features.flags.unknown.label",
    description: "features.flags.unknown.description",
  };
}
