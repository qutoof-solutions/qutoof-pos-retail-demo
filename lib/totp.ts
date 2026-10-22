import { PRODUCT_NAME } from "@/lib/brand";

const encoder = new TextEncoder();
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function createTotpUri(secret: string, email: string): string {
  const issuer = PRODUCT_NAME;
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export async function calculateTotp(secret: string, timestampMs = Date.now()): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(timestampMs / 30_000);
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) * 0x1000000)
    + ((hmac[offset + 1]! & 0xff) << 16)
    + ((hmac[offset + 2]! & 0xff) << 8)
    + (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secret: string, code: string, timestampMs = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [-30_000, 0, 30_000]) {
    if (constantTimeTextEqual(await calculateTotp(secret, timestampMs + drift), code)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.getRandomValues(new Uint8Array(10)));
    return `${raw.slice(0, 8)}-${raw.slice(8, 16)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 12 || normalized.length > 32) throw new Error("Invalid recovery code");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(normalized)));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function encryptTotpSecret(secret: string, sessionSecret: string): Promise<string> {
  const key = await deriveTotpKey(sessionSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(secret)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

export async function decryptTotpSecret(value: string, sessionSecret: string): Promise<string | null> {
  try {
    const [version, ivValue, encryptedValue] = value.split(".");
    if (version !== "v1" || !ivValue || !encryptedValue) return null;
    const key = await deriveTotpKey(sessionSecret);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(ivValue)) }, key, toArrayBuffer(base64UrlDecode(encryptedValue)));
    const secret = new TextDecoder().decode(decrypted);
    return /^[A-Z2-7]{20,40}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

async function deriveTotpKey(sessionSecret: string): Promise<CryptoKey> {
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  const material = await crypto.subtle.importKey("raw", encoder.encode(sessionSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("qutoof-auth-totp-salt-v1"), info: encoder.encode("qutoof-super-admin-totp") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(value: string): Uint8Array {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("Invalid Base32 secret");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(output);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
