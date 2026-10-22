import { drizzle } from "drizzle-orm/d1";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { schema } from "@/lib/db/schema";

export function getRuntimeEnv() {
  return getRequestContext().env as { DB: D1Database; KV_BINDING: KVNamespace; FILES: R2Bucket; SESSION_SECRET?: string; SUPER_ADMIN_BOOTSTRAP_SECRET?: string; APP_ENV?: string; WHATSAPP_APP_SECRET?: string; WHATSAPP_VERIFY_TOKEN?: string; WHATSAPP_TOKEN_ENCRYPTION_KEY?: string; WHATSAPP_ENCRYPTION_KEY?: string; WHATSAPP_CRON_SECRET?: string; WHATSAPP_GRAPH_API_VERSION?: string; NEXT_PUBLIC_BASE_URL?: string; APP_BASE_URL?: string; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; TELEGRAM_ADMIN_CHAT_ID?: string; TELEGRAM_ADMIN_USER_ID?: string; TELEGRAM_ADMIN_ACCOUNT_ID?: string; TELEGRAM_WEBHOOK_SECRET?: string; BILLING_CRON_SECRET?: string };
}

export function getDb() {
  return drizzle(getRuntimeEnv().DB, { schema });
}
