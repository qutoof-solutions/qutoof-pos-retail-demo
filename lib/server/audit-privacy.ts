const sensitiveResourceTypes = new Set([
  "customer",
  "patient_record",
  "clinical_encounter",
  "clinical_prescription",
  "appointment",
  "digital_ticket",
  "customer_entitlement",
  "invoice",
  "queue_ticket",
]);

const sensitiveActionPrefixes = [
  "clinical.",
  "patient_record.",
  "appointment.",
  "customer.",
  "digital_ticket.",
  "queue.ticket",
  "customer_entitlement.",
] as const;

const sensitiveMetadataKey = /(customer|patient|appointment|prescription|encounter|provider|practitioner|phone|email|address|token|secret|password|diagnosis|medicine|drug|notes|body|reference|idempotencykey)/i;
const safeOperationalMetadataKeys = new Set(["tokenRotated", "drugInteractionChecking"]);

export type AuditMetadata = Record<string, unknown>;

/** Strip identifiers/content that could connect an audit row to a person or clinical record. */
export function sanitizeAuditPayload(
  resourceType: string,
  action: string,
  resourceId: string | null,
  metadata: AuditMetadata,
): { resourceId: string | null; metadata: AuditMetadata } {
  const hideResourceId = sensitiveResourceTypes.has(resourceType)
    || sensitiveActionPrefixes.some((prefix) => action.startsWith(prefix));
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => safeOperationalMetadataKeys.has(key) || !sensitiveMetadataKey.test(key)),
  );
  return { resourceId: hideResourceId ? null : resourceId, metadata: safeMetadata };
}
