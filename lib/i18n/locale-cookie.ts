export const LOCALE_COOKIE_NAME = "qutoof-locale";
export const LOCALE_STORAGE_KEY = "qutoof-locale";
export const DEFAULT_LOCALE = "ar" as const;
export const LOCALES = ["ar", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export function resolveAppLocale(value: string | null | undefined): AppLocale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

export async function resolveAppLocaleSafely(readValue: () => Promise<string | null | undefined>): Promise<AppLocale> {
  try {
    return resolveAppLocale(await readValue());
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function readAppLocaleCookie(cookieHeader: string): AppLocale {
  const prefix = `${LOCALE_COOKIE_NAME}=`;
  const value = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return resolveAppLocale(value);
}

export function localeDirection(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function createLocaleCookie(locale: AppLocale, secure = false): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
