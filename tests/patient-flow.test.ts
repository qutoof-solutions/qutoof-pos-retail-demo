import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPatientFlowStatus, patientFlowLabel } from "../lib/operations/patient-flow";

test("patient flow exposes only the expected next step from waiting and in-room states", () => {
  assert.equal(nextPatientFlowStatus("waiting"), "in_progress");
  assert.equal(nextPatientFlowStatus("in_progress"), "completed");
  assert.equal(nextPatientFlowStatus("completed"), null);
  assert.equal(nextPatientFlowStatus("confirmed"), null);
  assert.equal(nextPatientFlowStatus("cancelled"), null);
});

test("patient flow labels clearly identify reception waiting, examination room and completion", () => {
  assert.equal(patientFlowLabel("waiting"), "قيد الانتظار في الاستقبال");
  assert.equal(patientFlowLabel("in_progress"), "داخل غرفة الكشف");
  assert.equal(patientFlowLabel("completed"), "مكتمل");
  assert.equal(patientFlowLabel("confirmed"), null);
});
