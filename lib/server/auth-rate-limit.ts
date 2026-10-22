export const AUTH_ATTEMPT_WINDOW_SECONDS = 15 * 60;
export const AUTH_MAX_FAILURES = 8;

type AttemptKeys = readonly [string, string];

export async function authAttemptKeys(email: string, request: Request, sessionSecret: string): Promise<AttemptKeys> {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = cfIp || forwardedIp || "unknown";
  const normalizedEmail = email.trim().toLowerCase();
  return [await keyedDigest(`email:${normalizedEmail}`, sessionSecret), await keyedDigest(`ip:${ip}`, sessionSecret)];
}

export async function isAuthRateLimited(db: D1Database, keys: AttemptKeys, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const result = await db.prepare(
    "SELECT COUNT(*) AS blocked FROM auth_login_attempts WHERE attempt_key IN (?, ?) AND window_started_at > ? AND attempts >= ?",
  ).bind(keys[0], keys[1], now - AUTH_ATTEMPT_WINDOW_SECONDS, AUTH_MAX_FAILURES).first<{ blocked: number }>();
  return Number(result?.blocked ?? 0) > 0;
}

export async function recordAuthFailure(db: D1Database, keys: AttemptKeys, now = Math.floor(Date.now() / 1000)): Promise<void> {
  const statements = keys.map((key) => db.prepare(
    `INSERT INTO auth_login_attempts (attempt_key, window_started_at, attempts, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       window_started_at = CASE WHEN auth_login_attempts.window_started_at <= ? THEN ? ELSE auth_login_attempts.window_started_at END,
       attempts = CASE WHEN auth_login_attempts.window_started_at <= ? THEN 1 ELSE auth_login_attempts.attempts + 1 END,
       updated_at = excluded.updated_at`,
  ).bind(key, now, now, now - AUTH_ATTEMPT_WINDOW_SECONDS, now, now - AUTH_ATTEMPT_WINDOW_SECONDS));
  await db.batch(statements);
}

export async function clearAuthFailures(db: D1Database, keys: AttemptKeys): Promise<void> {
  await db.prepare("DELETE FROM auth_login_attempts WHERE attempt_key IN (?, ?)").bind(keys[0], keys[1]).run();
}

async function keyedDigest(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
