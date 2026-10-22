import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "qutoof_session";
export const ADMIN_BACKUP_COOKIE = "qutoof_admin_backup";
export const TOTP_CHALLENGE_COOKIE = "qutoof_2fa_challenge";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60;
export const AUTH_ROLES = ["super_admin", "business_admin", "reception", "provider", "owner", "admin", "doctor", "specialist", "receptionist", "storekeeper", "nurse"] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

export function buildSessionCookie(token: string, requestUrl: string, maxAgeSeconds = SESSION_TTL_SECONDS): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildExpiredSessionCookie(requestUrl: string): string {
  return buildSessionCookie("", requestUrl, 0);
}

export function buildNamedSessionCookie(name: string, token: string, requestUrl: string, maxAgeSeconds = SESSION_TTL_SECONDS, sameSite: "Lax" | "Strict" = "Lax"): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly${secure}; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}`;
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  tenantId: string | null;
  role: AuthRole;
  email: string;
  fullName: string;
  authGeneration?: string;
  impersonationId?: string;
  impersonatorId?: string;
}

function keyFromSecret(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

// Deliberately tuned for Cloudflare Workers' per-request CPU budget; this lowers
// offline password-guessing cost versus the former 310,000-round setting.
const PASSWORD_HASH_ITERATIONS = 10_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_HASH_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PASSWORD_HASH_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, roundsText, saltText, expectedText] = encoded.split("$");
  if (algorithm !== "pbkdf2-sha256" || !roundsText || !saltText || !expectedText) return false;
  const rounds = Number(roundsText);
  if (!Number.isInteger(rounds) || rounds < PASSWORD_HASH_ITERATIONS || rounds > 1_000_000) return false;
  const salt = fromBase64Url(saltText);
  const expected = fromBase64Url(expectedText);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations: rounds }, key, expected.length * 8);
  return constantTimeEqual(new Uint8Array(bits), expected);
}

export async function createSession(claims: { sub: string; tenantId: string | null; role: AuthRole; email: string; fullName: string; authGeneration?: string; impersonationId?: string; impersonatorId?: string }, secret: string): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId, role: claims.role, email: claims.email, fullName: claims.fullName, ...(claims.authGeneration ? { authGeneration: claims.authGeneration } : {}), ...(claims.impersonationId ? { impersonationId: claims.impersonationId } : {}), ...(claims.impersonatorId ? { impersonatorId: claims.impersonatorId } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(claims.sub).setIssuedAt().setExpirationTime(`${SESSION_TTL_SECONDS}s`).sign(keyFromSecret(secret));
}

export async function readSession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyFromSecret(secret), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.role !== "string" || !AUTH_ROLES.includes(payload.role as AuthRole) || typeof payload.email !== "string" || typeof payload.fullName !== "string") return null;
    const tenantId = payload.tenantId;
    if (tenantId !== null && typeof tenantId !== "string") return null;
    const authGeneration = payload.authGeneration;
    if (authGeneration !== undefined && (typeof authGeneration !== "string" || authGeneration.length < 1 || authGeneration.length > 128)) return null;
    const impersonationId = payload.impersonationId;
    const impersonatorId = payload.impersonatorId;
    if ((impersonationId !== undefined && typeof impersonationId !== "string") || (impersonatorId !== undefined && typeof impersonatorId !== "string") || (Boolean(impersonationId) !== Boolean(impersonatorId))) return null;
    if (impersonationId && (payload.role !== "business_admin" || !tenantId || !impersonatorId)) return null;
    return { ...payload, sub: payload.sub, tenantId: tenantId as string | null, role: payload.role as AuthRole, email: payload.email, fullName: payload.fullName, ...(authGeneration ? { authGeneration } : {}), ...(impersonationId ? { impersonationId, impersonatorId: impersonatorId as string } : {}) };
  } catch {
    return null;
  }
}

export async function createTwoFactorChallenge(userId: string, secret: string): Promise<string> {
  return new SignJWT({ purpose: "totp_login" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOTP_CHALLENGE_TTL_SECONDS}s`)
    .sign(keyFromSecret(secret));
}

export async function readTwoFactorChallenge(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keyFromSecret(secret), { algorithms: ["HS256"] });
    return payload.purpose === "totp_login" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function hasRole(session: SessionClaims, allowed: readonly AuthRole[]): boolean {
  return allowed.includes(session.role);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
