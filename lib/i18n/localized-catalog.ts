import type { DataLocale } from "@/lib/operations/data-portability";

export type LocalizedCatalogName = { nameAr?: string | null; nameEn?: string | null };

/**
 * Catalog records created before bilingual display names were enforced used
 * nameEn as a stable code. Keep those records readable while preferring the
 * explicitly stored English value for all new records.
 */
export function catalogName(value: LocalizedCatalogName, locale: DataLocale): string {
  const arabic = value.nameAr?.trim() ?? "";
  const english = value.nameEn?.trim() ?? "";
  if (locale === "ar") return arabic || english || "—";
  if (!english) return arabic || "—";
  return looksLikeCatalogCode(english) ? humanizeCatalogCode(english) : english;
}

export function humanizeCatalogCode(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikeCatalogCode(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(value);
}

export function localizedText(arabic: string | null | undefined, english: string | null | undefined, locale: DataLocale, fallback: string): string {
  const selected = locale === "ar" ? arabic : english;
  return selected?.trim() || (locale === "ar" ? english?.trim() : arabic?.trim()) || fallback;
}
