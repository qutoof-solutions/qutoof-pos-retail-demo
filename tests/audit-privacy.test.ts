import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditPayload } from "@/lib/server/audit-privacy";

test("clinical audit payloads omit patient, appointment, and resource identifiers", () => {
  const safe = sanitizeAuditPayload("clinical_prescription", "clinical.prescription.created", "record-uuid", {
    customerId: "customer-uuid",
    appointmentId: "appointment-uuid",
    practitionerId: "staff-uuid",
    drugInteractionChecking: false,
    createdCount: 1,
  });
  assert.equal(safe.resourceId, null);
  assert.deepEqual(safe.metadata, { drugInteractionChecking: false, createdCount: 1 });
});

test("personal contacts, secrets, request references and idempotency keys are removed", () => {
  const safe = sanitizeAuditPayload("whatsapp_connection", "whatsapp.connection_saved", "connection-uuid", {
    phoneNumberId: "meta-phone-id",
    accessToken: "secret-value",
    email: "patient@example.test",
    tokenRotated: true,
    idempotencyKey: "request-key",
  });
  assert.equal(safe.resourceId, "connection-uuid");
  assert.deepEqual(safe.metadata, { tokenRotated: true });
});

test("non-clinical operational counts remain available for audit", () => {
  const safe = sanitizeAuditPayload("stock_operation", "inventory.adjustment", "operation-uuid", {
    branchId: "branch-uuid",
    movements: 3,
    totalMinor: 1200,
  });
  assert.equal(safe.resourceId, "operation-uuid");
  assert.deepEqual(safe.metadata, { branchId: "branch-uuid", movements: 3, totalMinor: 1200 });
});
