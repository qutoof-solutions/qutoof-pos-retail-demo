import { ADMIN_BACKUP_COOKIE, readSession, SESSION_COOKIE, type SessionClaims } from "@/lib/auth";
import type { getRuntimeEnv } from "@/lib/db/client";

type RuntimeEnv = ReturnType<typeof getRuntimeEnv>;

// Keep this longer than the 12-hour JWT lifetime so a revoked generation cannot
// disappear and accidentally make an old, legacy token valid again.
export const AUTH_GENERATION_TTL_SECONDS = 60 * 60 * 24;

function authGenerationKey(userId: string): string {
  return `auth-generation:${userId}`;
}

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      try { return decodeURIComponent(trimmed.slice(name.length + 1)); } catch { return null; }
    }
  }
  return null;
}

export async function revokeUserSessionsBeforeCredentialMutation(kv: Pick<KVNamespace, "delete">, userId: string, attempts = 2): Promise<void> {
  const retryCount = Math.max(1, Math.floor(attempts));
  let lastError: unknown;
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      await kv.delete(`session:${userId}`);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Unable to revoke user sessions before credential mutation", { cause: lastError });
}

export async function readOrCreateUserAuthGeneration(kv: Pick<KVNamespace, "get" | "put">, userId: string, attempts = 2): Promise<string> {
  const retryCount = Math.max(1, Math.floor(attempts));
  let lastError: unknown;
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      const current = await kv.get(authGenerationKey(userId));
      if (current) {
        await kv.put(authGenerationKey(userId), current, { expirationTtl: AUTH_GENERATION_TTL_SECONDS });
        return current;
      }
      const generation = crypto.randomUUID();
      await kv.put(authGenerationKey(userId), generation, { expirationTtl: AUTH_GENERATION_TTL_SECONDS });
      return generation;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Unable to read auth generation", { cause: lastError });
}

export async function rotateUserAuthGenerationBeforeCredentialMutation(kv: Pick<KVNamespace, "get" | "put" | "delete">, userId: string, attempts = 2): Promise<void> {
  // Publish the tombstone first. If deleting the old marker fails, the old JWT
  // is still rejected by generation and credentials remain unchanged.
  await readOrCreateUserAuthGeneration(kv, userId, attempts);
  const retryCount = Math.max(1, Math.floor(attempts));
  let lastError: unknown;
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      await kv.put(authGenerationKey(userId), crypto.randomUUID(), { expirationTtl: AUTH_GENERATION_TTL_SECONDS });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error("Unable to rotate auth generation", { cause: lastError });
  await revokeUserSessionsBeforeCredentialMutation(kv, userId, attempts);
}

async function hasActiveSessionMarker(kv: Pick<KVNamespace, "get">, userId: string): Promise<boolean> {
  try {
    return (await kv.get(`session:${userId}`)) === "active";
  } catch {
    return false;
  }
}

export async function resolveAuthenticatedSession(sessionToken: string | null, backupToken: string | null, env: RuntimeEnv): Promise<SessionClaims | null> {
  if (!sessionToken || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return null;
  const session = await readSession(sessionToken, env.SESSION_SECRET);
  if (!session) return null;
  let currentGeneration: string | null;
  try {
    currentGeneration = await env.KV_BINDING.get(authGenerationKey(session.sub));
  } catch {
    return null;
  }
  if (session.authGeneration ? currentGeneration !== session.authGeneration : currentGeneration !== null) return null;
  if (!session.impersonationId) {
    if (!(await hasActiveSessionMarker(env.KV_BINDING, session.sub))) return null;
    return session;
  }
  if (!backupToken || !session.impersonatorId) return null;
  const adminSession = await readSession(backupToken, env.SESSION_SECRET);
  if (!adminSession || adminSession.role !== "super_admin" || adminSession.tenantId !== null || adminSession.sub !== session.impersonatorId) return null;
  let adminGeneration: string | null;
  try {
    adminGeneration = await env.KV_BINDING.get(authGenerationKey(adminSession.sub));
  } catch {
    return null;
  }
  if (adminSession.authGeneration ? adminGeneration !== adminSession.authGeneration : adminGeneration !== null) return null;
  if (!(await hasActiveSessionMarker(env.KV_BINDING, adminSession.sub))) return null;
  let activeImpersonation: string | null;
  try {
    activeImpersonation = await env.KV_BINDING.get(`impersonation:${session.impersonationId}`);
  } catch {
    return null;
  }
  if (!activeImpersonation) return null;
  try {
    const record = JSON.parse(activeImpersonation) as { actorId?: unknown; tenantId?: unknown; targetUserId?: unknown };
    if (record.actorId !== adminSession.sub || record.targetUserId !== session.sub || record.tenantId !== session.tenantId) return null;
  } catch {
    return null;
  }
  return session;
}

export async function resolveSessionFromCookieHeader(cookieHeader: string, env: RuntimeEnv): Promise<SessionClaims | null> {
  return resolveAuthenticatedSession(readCookie(cookieHeader, SESSION_COOKIE), readCookie(cookieHeader, ADMIN_BACKUP_COOKIE), env);
}
