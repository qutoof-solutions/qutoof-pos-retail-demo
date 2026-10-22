import { decryptTotpSecret, hashRecoveryCode, verifyTotp } from "@/lib/totp";
import { consumeRecoveryCode } from "@/lib/server/recovery";

export async function verifySecondFactor(
  db: D1Database,
  userId: string,
  encryptedTotpSecret: string | null,
  code: string,
  sessionSecret: string,
  nowMs = Date.now(),
): Promise<{ ok: boolean; usedRecoveryCode: boolean }> {
  const candidate = code.trim();
  if (/^\d{6}$/.test(candidate) && encryptedTotpSecret) {
    const secret = await decryptTotpSecret(encryptedTotpSecret, sessionSecret);
    if (secret && await verifyTotp(secret, candidate, nowMs)) return { ok: true, usedRecoveryCode: false };
  }

  let codeHash: string;
  try {
    codeHash = await hashRecoveryCode(candidate);
  } catch {
    return { ok: false, usedRecoveryCode: false };
  }
  const now = Math.floor(nowMs / 1000);
  const consumed = await consumeRecoveryCode(db, userId, codeHash, now);
  return { ok: consumed, usedRecoveryCode: consumed };
}
