import { cache } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, resolveAppLocaleSafely, type AppLocale } from "./locale-cookie";

/**
 * Request-scoped memoization only: never use a module-level cache for a
 * cookie-derived locale, since that could leak one user's locale to another.
 */
export const getServerLocale = cache(async (): Promise<AppLocale> =>
  resolveAppLocaleSafely(async () => (await cookies()).get(LOCALE_COOKIE_NAME)?.value),
);
