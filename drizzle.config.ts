import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: { url: "./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/00000000-0000-0000-0000-000000000000.sqlite" },
  strict: true,
  verbose: true,
});
