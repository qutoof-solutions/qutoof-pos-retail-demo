import assert from "node:assert/strict";
import { test } from "node:test";
import { changePasswordSchema, strongPasswordSchema } from "../lib/password-policy";

const validChange = {
  currentPassword: "OldPersonalPassword123",
  newPassword: "BlueRiverGarden2026",
  confirmPassword: "BlueRiverGarden2026",
};

test("strong password policy accepts a memorable passphrase and rejects weak values", () => {
  assert.equal(strongPasswordSchema.safeParse("BlueRiverGarden2026").success, true);
  assert.equal(strongPasswordSchema.safeParse("short1A").success, false);
  assert.equal(strongPasswordSchema.safeParse("bluerivergarden2026").success, false);
  assert.equal(strongPasswordSchema.safeParse("BlueRiverGarden").success, false);
  assert.equal(strongPasswordSchema.safeParse("BlueRiverGarden2026".repeat(8)).success, false);
});

test("password change requires a matching confirmation and a different password", () => {
  assert.equal(changePasswordSchema.safeParse(validChange).success, true);
  assert.equal(changePasswordSchema.safeParse({ ...validChange, confirmPassword: "AnotherPassword2026" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ ...validChange, newPassword: validChange.currentPassword, confirmPassword: validChange.currentPassword }).success, false);
  assert.equal(changePasswordSchema.safeParse({ ...validChange, currentPassword: "" }).success, false);
});
