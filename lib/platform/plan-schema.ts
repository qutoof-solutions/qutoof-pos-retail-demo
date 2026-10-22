import { getRuntimeEnv } from "@/lib/db/client";

type TableInfoRow = { name?: string };

/**
 * Keeps deployments that received the UI/code before migration 0046 usable.
 * Existing rows receive empty descriptions, so this is backward compatible.
 */
export async function ensurePlatformPlanDescriptionColumns(): Promise<void> {
  const db = getRuntimeEnv().DB;
  const result = await db.prepare("PRAGMA table_info(\"platform_plans\")").all<TableInfoRow>();
  const existing = new Set((result.results ?? []).map((row) => String(row.name ?? "")));
  if (!existing.size) return;

  for (const [column, definition] of [
    ["description_ar", "TEXT NOT NULL DEFAULT ''"],
    ["description_en", "TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (existing.has(column)) continue;
    try {
      await db.prepare(`ALTER TABLE "platform_plans" ADD COLUMN "${column}" ${definition}`).run();
    } catch (cause) {
      // Two first requests can race during a cold deployment. A duplicate-column
      // error is safe; any other error must surface so it is not hidden as success.
      const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
      if (!message.includes("duplicate column") && !message.includes("already exists")) throw cause;
    }
  }
}
