import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/totp";

export const RECOVERY_CODE_COUNT = 10;

export type RecoveryCodeRecord = {
  plainCode: string;
  codeHash: string;
};

export type RecoveryResetUser = {
  id: string;
  tenantId: string | null;
};

export async function createRecoveryCodeRecords(): Promise<RecoveryCodeRecord[]> {
  const codes = generateRecoveryCodes();
  if (codes.length !== RECOVERY_CODE_COUNT) throw new Error("Unexpected recovery code count");
  return Promise.all(codes.map(async (plainCode) => ({ plainCode, codeHash: await hashRecoveryCode(plainCode) })));
}

export async function consumeRecoveryCode(db: Pick<D1Database, "prepare">, userId: string, codeHash: string, now: number, consumptionId = crypto.randomUUID()): Promise<boolean> {
  const result = await db.prepare("UPDATE auth_recovery_codes SET used_at = ?, consumption_id = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
    .bind(now, consumptionId, userId, codeHash)
    .run();
  return result.meta.changes === 1;
}

export async function hasUsableRecoveryCode(db: Pick<D1Database, "prepare">, userId: string, tenantId: string | null, codeHash: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS usable FROM auth_recovery_codes c INNER JOIN users u ON u.id = c.user_id WHERE c.user_id = ? AND c.code_hash = ? AND c.used_at IS NULL AND u.tenant_id IS ? AND u.is_active = 1 LIMIT 1")
    .bind(userId, codeHash, tenantId).first<{ usable: number }>();
  return row?.usable === 1;
}

export async function resetPasswordWithRecovery(
  db: Pick<D1Database, "prepare" | "batch">,
  user: RecoveryResetUser,
  codeHash: string,
  passwordHash: string,
  now: number,
  userAgent: string | null,
): Promise<boolean> {
  const consumptionId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare("UPDATE auth_recovery_codes SET used_at = ?, consumption_id = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ? AND tenant_id IS ? AND is_active = 1)").bind(now, consumptionId, user.id, codeHash, user.id, user.tenantId),
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND tenant_id IS ? AND is_active = 1 AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ? AND code_hash = ? AND consumption_id = ? AND used_at = ?)").bind(passwordHash, now, user.id, user.tenantId, user.id, codeHash, consumptionId, now),
    db.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, ?, ?, 'auth.password_recovered', 'user', ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ? AND code_hash = ? AND consumption_id = ? AND used_at = ?)").bind(crypto.randomUUID(), user.tenantId, user.id, user.id, userAgent, JSON.stringify({ method: "recovery_code" }), now, user.id, codeHash, consumptionId, now),
  ]);
  return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1 && results[2]?.meta.changes === 1;
}
