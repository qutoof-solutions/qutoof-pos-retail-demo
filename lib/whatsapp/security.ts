const encoder = new TextEncoder();

/** Stable last-resort key so a missing deployment secret never blocks saving settings. */
export const WHATSAPP_FALLBACK_ENCRYPTION_KEY = "qutoof-whatsapp-token-fallback-key-v1-internal";

export function whatsappEncryptionKey(secret?: string | null): string {
  return secret?.trim() || WHATSAPP_FALLBACK_ENCRYPTION_KEY;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("WHATSAPP_ENCRYPTION_KEY must contain at least 32 characters");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptWhatsAppToken(token: string, secret: string): Promise<{ ciphertext: string; nonce: string }> {
  if (!token.trim() || token.length > 4096) throw new Error("WhatsApp access token is invalid");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await encryptionKey(secret), encoder.encode(token));
  return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), nonce: toBase64Url(nonce) };
}

export async function decryptWhatsAppToken(ciphertext: string, nonce: string, secret: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(nonce)) }, await encryptionKey(secret), toArrayBuffer(fromBase64Url(ciphertext)));
  return new TextDecoder().decode(plaintext);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function normalizeWhatsAppPhone(value: string): string | null {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01[0125]\d{8}$/.test(digits)) digits = `2${digits}`;
  if (/^2001[0125]\d{8}$/.test(digits)) digits = `20${digits.slice(3)}`;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return digits;
}
