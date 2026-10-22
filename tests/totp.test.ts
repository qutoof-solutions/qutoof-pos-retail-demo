import test from "node:test";
import assert from "node:assert/strict";
import { createTwoFactorChallenge, createSession, readTwoFactorChallenge } from "../lib/auth";
import { authAttemptKeys } from "../lib/server/auth-rate-limit";
import { calculateTotp, createTotpUri, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeRecoveryCode, verifyTotp } from "../lib/totp";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("TOTP matches RFC 6238 SHA-1 six-digit vector", async () => {
  assert.equal(await calculateTotp(secret, 59_000), "287082");
  assert.equal(await verifyTotp(secret, "287082", 59_000), true);
  assert.equal(await verifyTotp(secret, "287083", 59_000), false);
});

test("TOTP tolerates one 30-second clock step and creates a standards URI", async () => {
  const code = await calculateTotp(secret, 60_000);
  assert.equal(await verifyTotp(secret, code, 30_000), true);
  assert.match(createTotpUri(secret, "owner@example.com"), /^otpauth:\/\/totp\//);
});

test("encrypted TOTP seed decrypts only with the same session secret", async () => {
  const seed = generateTotpSecret();
  const encrypted = await encryptTotpSecret(seed, "a-stable-session-secret-with-at-least-32-chars");
  assert.equal(await decryptTotpSecret(encrypted, "a-stable-session-secret-with-at-least-32-chars"), seed);
  assert.equal(await decryptTotpSecret(encrypted, "a-different-session-secret-with-at-least-32-chars"), null);
});

test("recovery codes are unique, normalized, and stored only as hashes", async () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(normalizeRecoveryCode(codes[0]!), codes[0]!.replace(/-/g, ""));
  assert.match(await hashRecoveryCode(codes[0]!), /^[a-f0-9]{64}$/);
});

test("short-lived 2FA challenges cannot be confused with full login sessions", async () => {
  const sessionSecret = "a-stable-session-secret-with-at-least-32-chars";
  const challenge = await createTwoFactorChallenge("owner-id", sessionSecret);
  assert.equal(await readTwoFactorChallenge(challenge, sessionSecret), "owner-id");
  const session = await createSession({ sub: "owner-id", tenantId: null, role: "super_admin", email: "owner@example.com", fullName: "Owner" }, sessionSecret);
  assert.equal(await readTwoFactorChallenge(session, sessionSecret), null);
});

test("login limiter stores deterministic HMAC keys rather than email or IP values", async () => {
  const request = new Request("https://example.com/api/auth/login", { headers: { "cf-connecting-ip": "203.0.113.8" } });
  const first = await authAttemptKeys("Owner@Example.com", request, "a-stable-session-secret-with-at-least-32-chars");
  const repeat = await authAttemptKeys("owner@example.com", request, "a-stable-session-secret-with-at-least-32-chars");
  assert.deepEqual(first, repeat);
  assert.equal(first.length, 2);
  assert.ok(first.every((key) => /^[a-f0-9]{64}$/.test(key)));
  assert.ok(first.every((key) => !key.includes("owner") && !key.includes("203.0.113.8")));
});
