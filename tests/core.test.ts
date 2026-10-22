import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpiredSessionCookie, buildSessionCookie, createSession, hashPassword, hasRole, readSession, verifyPassword } from "../lib/auth";
import { getTerm, TERMS } from "../lib/terms";
import { payloadFingerprint } from "../lib/operations/idempotency";

const testSecret = "a-secure-test-secret-with-more-than-32-characters";

test("idempotency payload fingerprints ignore object key order but detect changed values", async () => {
  const first = await payloadFingerprint({ invoiceId: "invoice-1", payment: { amountMinor: 100, method: "cash" } });
  const reordered = await payloadFingerprint({ payment: { method: "cash", amountMinor: 100 }, invoiceId: "invoice-1" });
  const changed = await payloadFingerprint({ invoiceId: "invoice-1", payment: { amountMinor: 200, method: "cash" } });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("password hashes are salted, verifiable, and reject wrong passwords", async () => {
  const firstHash = await hashPassword("StrongPassword123");
  const secondHash = await hashPassword("StrongPassword123");
  assert.notEqual(firstHash, secondHash);
  assert.equal(firstHash.split("$")[1], "10000");
  assert.equal(await verifyPassword("StrongPassword123", firstHash), true);
  assert.equal(await verifyPassword("WrongPassword123", firstHash), false);
  assert.equal(await verifyPassword("StrongPassword123", "invalid"), false);
  assert.equal(await verifyPassword("StrongPassword123", "pbkdf2-sha256$9999$YWJj$YWJj"), false);
});

test("signed session claims verify and preserve tenant role identity", async () => {
  const token = await createSession({ sub: "user-1", tenantId: "tenant-1", role: "provider", email: "provider@example.test", fullName: "Provider" }, testSecret);
  const session = await readSession(token, testSecret);
  assert.equal(session?.sub, "user-1");
  assert.equal(session?.tenantId, "tenant-1");
  assert.equal(session?.role, "provider");
  assert.equal(await readSession(token, `${testSecret}-wrong`), null);
  assert.equal(session ? hasRole(session, ["provider", "business_admin"]) : false, true);
});

test("signed sessions accept additive tenant roles without rewriting legacy role claims", async () => {
  for (const role of ["owner", "admin", "doctor", "specialist", "receptionist", "storekeeper"] as const) {
    const token = await createSession({ sub: `user-${role}`, tenantId: "tenant-1", role, email: `${role}@example.test`, fullName: role }, testSecret);
    assert.equal((await readSession(token, testSecret))?.role, role);
  }
  const legacy = await createSession({ sub: "old", tenantId: "tenant-1", role: "business_admin", email: "old@example.test", fullName: "Old" }, testSecret);
  assert.equal((await readSession(legacy, testSecret))?.role, "business_admin");
});

test("vertical-specific Arabic terms are complete and selectable", () => {
  assert.equal(getTerm("medical", "customer"), "مريض");
  assert.equal(getTerm("beauty", "appointment"), "جلسة");
  assert.equal(getTerm("sports", "provider"), "مدرب أو ملعب");
  assert.equal(getTerm("consulting", "customer"), "موكل");
  assert.equal(getTerm("retail", "appointment"), "عملية بيع");
  assert.equal(getTerm("wholesale", "customer"), "عميل جملة");
  assert.equal(getTerm("restaurant", "service"), "صنف قائمة");
  assert.deepEqual(Object.keys(TERMS), ["medical", "beauty", "sports", "consulting", "retail", "wholesale", "restaurant"]);
});

test("session cookies are Secure on HTTPS and remain usable in local HTTP preview", () => {
  const productionCookie = buildSessionCookie("token", "https://qutoofcrm.example/dashboard");
  const localCookie = buildSessionCookie("token", "http://127.0.0.1:8788/dashboard");
  assert.match(productionCookie, /; Secure;/);
  assert.doesNotMatch(localCookie, /; Secure;/);
  assert.match(localCookie, /HttpOnly; SameSite=Lax/);
  assert.match(buildExpiredSessionCookie("https://qutoofcrm.example"), /Max-Age=0/);
});
