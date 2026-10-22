import type { AuthRole } from "@/lib/auth";
import { isBusinessAdminRole } from "@/lib/operations/permissions";
import type { InsuranceClaimStatus } from "@/lib/operations/medical-contracts";

export const INSURANCE_CLAIM_EVENT_TYPES = ["created", "status_transition"] as const;
export type InsuranceClaimEventType = (typeof INSURANCE_CLAIM_EVENT_TYPES)[number];

/** The event key is deliberately distinct from the claim request key. */
export function claimCreationEventKey(requestKey: string): string {
  return `insurance-claim:${requestKey}:created`;
}

/**
 * Approval, rejection, and payment are financial controls. Submit remains
 * available to branch-authorized operations staff; all callers are still
 * scoped to the invoice's linked branch by the API route.
 */
export function canPerformInsuranceClaimTransition(role: AuthRole, nextStatus: InsuranceClaimStatus): boolean {
  return nextStatus === "submitted" || isBusinessAdminRole(role);
}

export function claimTransitionEventKey(claimId: string, requestKey: string): string {
  return `insurance-claim:${claimId}:transition:${requestKey}`;
}

export function claimEventPayload(input: {
  claimId: string;
  nextStatus: InsuranceClaimStatus;
  expectedVersion: number;
  rejectionReason?: string | null;
}): Record<string, unknown> {
  return {
    claimId: input.claimId,
    nextStatus: input.nextStatus,
    expectedVersion: input.expectedVersion,
    rejectionReason: input.rejectionReason ?? null,
  };
}

export function parseClaimEventMetadata(metadataJson: string | null | undefined): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export type NormalizedInsuranceClaimEvent = {
  id: string;
  claimId: string;
  version: number;
  type: InsuranceClaimEventType | string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  actorName: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export function normalizeClaimEvent(row: {
  id: string;
  claimId: string;
  version: number;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  actorName: string | null;
  idempotencyKey: string;
  metadataJson: string | null;
  createdAt: Date;
}): NormalizedInsuranceClaimEvent {
  return { ...row, metadata: parseClaimEventMetadata(row.metadataJson) };
}
