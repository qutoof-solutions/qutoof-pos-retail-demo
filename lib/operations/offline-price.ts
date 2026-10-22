export type OfflinePriceItemType = "service" | "inventory";

export type OfflinePriceClaims = {
  tenantId: string;
  itemType: OfflinePriceItemType;
  itemId: string;
  unitId?: string | null;
  branchId: string | null;
  unitPriceMinor: number;
  issuedAt: number;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalClaims(claims: OfflinePriceClaims): string {
  return JSON.stringify([2, claims.tenantId, claims.itemType, claims.itemId, claims.unitId ?? null, claims.branchId, claims.unitPriceMinor, claims.issuedAt]);
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("مفتاح توقيع سعر الأوفلاين غير مهيأ");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signOfflinePrice(secret: string, claims: OfflinePriceClaims): Promise<string> {
  const key = await signingKey(secret);
  const payload = new TextEncoder().encode(canonicalClaims(claims));
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return `${encodeBase64Url(payload)}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyOfflinePrice(
  secret: string,
  token: string,
  expected: Omit<OfflinePriceClaims, "issuedAt">,
): Promise<boolean> {
  try {
    const [payloadPart, signaturePart, extra] = token.split(".");
    if (!payloadPart || !signaturePart || extra !== undefined) return false;
    const payload = decodeBase64Url(payloadPart);
    const signature = decodeBase64Url(signaturePart);
    const key = await signingKey(secret);
    if (!await crypto.subtle.verify("HMAC", key, signature.slice().buffer as ArrayBuffer, payload.slice().buffer as ArrayBuffer)) return false;
    const decoded = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!Array.isArray(decoded) || (decoded.length !== 8 && decoded.length !== 7) || (decoded[0] !== 1 && decoded[0] !== 2)) return false;
    const claims: OfflinePriceClaims = {
      tenantId: decoded[1] as string,
      itemType: decoded[2] as OfflinePriceItemType,
      itemId: decoded[3] as string,
      unitId: decoded[0] === 2 ? decoded[4] as string | null : null,
      branchId: decoded[0] === 2 ? decoded[5] as string | null : decoded[4] as string | null,
      unitPriceMinor: decoded[0] === 2 ? decoded[6] as number : decoded[5] as number,
      issuedAt: decoded[0] === 2 ? decoded[7] as number : decoded[6] as number,
    };
    return claims.tenantId === expected.tenantId
      && claims.itemType === expected.itemType
      && claims.itemId === expected.itemId
      && (expected.unitId === undefined || claims.unitId === (expected.unitId ?? null))
      && (claims.branchId === null || claims.branchId === expected.branchId)
      && claims.unitPriceMinor === expected.unitPriceMinor
      && Number.isSafeInteger(claims.issuedAt)
      && claims.issuedAt > 0;
  } catch {
    return false;
  }
}
