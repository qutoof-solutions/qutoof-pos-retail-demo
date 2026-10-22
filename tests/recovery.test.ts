import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../lib/auth";
import { createRecoveryCodeRecords, consumeRecoveryCode, resetPasswordWithRecovery } from "../lib/server/recovery";
import { readOrCreateUserAuthGeneration, resolveAuthenticatedSession, revokeUserSessionsBeforeCredentialMutation, rotateUserAuthGenerationBeforeCredentialMutation } from "../lib/server/session";
import { hashRecoveryCode } from "../lib/totp";

test("recovery code records expose each plaintext once and store verifiable hashes", async () => {
  const records = await createRecoveryCodeRecords();
  assert.equal(records.length, 10);
  assert.equal(new Set(records.map((record) => record.plainCode)).size, 10);
  for (const record of records) {
    assert.equal(record.codeHash, await hashRecoveryCode(record.plainCode));
    assert.notEqual(record.codeHash, record.plainCode);
  }
});

test("recovery code consumption is one-use and bound to the owning user", async () => {
  const records = await createRecoveryCodeRecords();
  const targetUserId = "tenant-user-1";
  const otherUserId = "tenant-user-2";
  const row = { userId: targetUserId, codeHash: records[0]!.codeHash, usedAt: null as number | null, consumptionId: null as string | null };
  const db = {
    prepare(sql: string) {
      assert.match(sql, /^UPDATE auth_recovery_codes SET used_at/);
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              const [usedAt, consumptionId, userId, codeHash] = values;
              if (row.usedAt !== null || row.userId !== userId || row.codeHash !== codeHash) return { meta: { changes: 0 } };
              row.usedAt = usedAt as number;
              row.consumptionId = consumptionId as string;
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as Pick<D1Database, "prepare">;

  assert.equal(await consumeRecoveryCode(db, otherUserId, row.codeHash, 100, "wrong-user"), false);
  assert.equal(await consumeRecoveryCode(db, targetUserId, row.codeHash, 101, "first-use"), true);
  assert.equal(await consumeRecoveryCode(db, targetUserId, row.codeHash, 102, "replay"), false);
  assert.deepEqual(row, { userId: targetUserId, codeHash: records[0]!.codeHash, usedAt: 101, consumptionId: "first-use" });
});

test("password recovery transaction carries tenant isolation and audit metadata", async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return {};
        },
      };
    },
    async batch(batchStatements: unknown[]) {
      assert.equal(batchStatements.length, 3);
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as Pick<D1Database, "prepare" | "batch">;

  assert.equal(await resetPasswordWithRecovery(db, { id: "user-1", tenantId: "tenant-a" }, "hash-not-logged", "password-hash", 200, "browser"), true);
  assert.equal(statements[0]?.values[3], "hash-not-logged");
  assert.equal(statements[1]?.values[3], "tenant-a");
  assert.equal(statements[2]?.values[1], "tenant-a");
  assert.equal(JSON.parse(String(statements[2]?.values[5])).method, "recovery_code");
  assert.equal(String(statements[2]?.values[5]).includes("hash-not-logged"), false);
});

test("KV revocation fails closed before recovery mutation and is safe to retry", async () => {
  let failDeletes = true;
  let deleteCalls = 0;
  let batchCalls = 0;
  const kv = {
    async delete(key: string) {
      assert.equal(key, "session:user-1");
      deleteCalls += 1;
      if (failDeletes) throw new Error("KV unavailable");
    },
  };
  const db = {
    prepare() { return { bind() { return {}; } }; },
    async batch() {
      batchCalls += 1;
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as Pick<D1Database, "prepare" | "batch">;

  await assert.rejects(revokeUserSessionsBeforeCredentialMutation(kv, "user-1", 2), /Unable to revoke/);
  assert.equal(deleteCalls, 2);
  assert.equal(batchCalls, 0);

  failDeletes = false;
  await revokeUserSessionsBeforeCredentialMutation(kv, "user-1");
  assert.equal(deleteCalls, 3);
  assert.equal(await resetPasswordWithRecovery(db, { id: "user-1", tenantId: "tenant-1" }, "code-hash", "password-hash", 300, "test-agent"), true);
  assert.equal(batchCalls, 1);
});

test("session resolver rejects revoked, impersonated, and KV-error sessions", async () => {
  const secret = "session-secret-that-is-at-least-32-characters-long";
  const markers = new Map<string, string>([
    ["session:user-1", "active"],
    ["session:admin-1", "active"],
    ["impersonation:imp-1", JSON.stringify({ actorId: "admin-1", tenantId: "tenant-1", targetUserId: "user-1" })],
  ]);
  const env = {
    SESSION_SECRET: secret,
    KV_BINDING: {
      async get(key: string) { return markers.get(key) ?? null; },
    },
  } as never;
  const token = await createSession({ sub: "user-1", tenantId: "tenant-1", role: "provider", email: "user@example.test", fullName: "User" }, secret);
  assert.equal((await resolveAuthenticatedSession(token, null, env))?.sub, "user-1");
  markers.delete("session:user-1");
  assert.equal(await resolveAuthenticatedSession(token, null, env), null);

  markers.set("session:user-1", "active");
  const adminToken = await createSession({ sub: "admin-1", tenantId: null, role: "super_admin", email: "admin@example.test", fullName: "Admin" }, secret);
  const impersonatedToken = await createSession({ sub: "user-1", tenantId: "tenant-1", role: "business_admin", email: "user@example.test", fullName: "User", impersonationId: "imp-1", impersonatorId: "admin-1" }, secret);
  assert.equal((await resolveAuthenticatedSession(impersonatedToken, adminToken, env))?.sub, "user-1");
  markers.delete("session:user-1");
  assert.equal((await resolveAuthenticatedSession(impersonatedToken, adminToken, env))?.sub, "user-1");

  const failingEnv = {
    SESSION_SECRET: secret,
    KV_BINDING: { async get() { throw new Error("KV unavailable"); } },
  } as never;
  assert.equal(await resolveAuthenticatedSession(token, null, failingEnv), null);
});

test("generation rotation rejects old JWTs after reset while a new login remains valid", async () => {
  const secret = "session-secret-that-is-at-least-32-characters-long";
  const markers = new Map<string, string>([["session:user-1", "active"], ["auth-generation:user-1", "generation-1"]]);
  const kv = {
    async get(key: string) { return markers.get(key) ?? null; },
    async put(key: string, value: string) { markers.set(key, value); },
    async delete(key: string) { markers.delete(key); },
  };
  const env = { SESSION_SECRET: secret, KV_BINDING: kv } as never;
  const oldToken = await createSession({ sub: "user-1", tenantId: "tenant-1", role: "provider", email: "user@example.test", fullName: "User", authGeneration: "generation-1" }, secret);
  assert.equal((await resolveAuthenticatedSession(oldToken, null, env))?.sub, "user-1");
  await rotateUserAuthGenerationBeforeCredentialMutation(kv, "user-1");
  assert.equal(await resolveAuthenticatedSession(oldToken, null, env), null);
  const newGeneration = await readOrCreateUserAuthGeneration(kv, "user-1");
  markers.set("session:user-1", "active");
  const newToken = await createSession({ sub: "user-1", tenantId: "tenant-1", role: "provider", email: "user@example.test", fullName: "User", authGeneration: newGeneration }, secret);
  assert.equal((await resolveAuthenticatedSession(newToken, null, env))?.sub, "user-1");
  assert.equal(await resolveAuthenticatedSession(oldToken, null, env), null);
});
