import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";
import { LOCALE_COOKIE_NAME, readAppLocaleCookie, type AppLocale } from "./locale-cookie";

type P1ServerMessages = typeof arMessages.p1Server;
type P1ServerLeafKey = {
  [Section in keyof P1ServerMessages]: `${Extract<Section, string>}.${Extract<keyof P1ServerMessages[Section], string>}`;
}[keyof P1ServerMessages];
export type P1ServerMessageKey = `p1Server.${P1ServerLeafKey}`;
export type ServerMessageKey = P1ServerMessageKey | "errors.sessionExpired";
type MessageVariables = Record<string, string | number>;

type MessageCatalog = { p1Server: P1ServerMessages; errors: { sessionExpired: string } };

function acceptLanguageLocale(value: string | null): AppLocale {
  const first = value?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "en" || first.startsWith("en-") ? "en" : "ar";
}

/** Resolve a route's locale without importing next/headers (which is unavailable in a request helper). */
export function resolveRequestLocale(request: Request): AppLocale {
  const cookie = request.headers.get("cookie") ?? "";
  if (cookie.split(";").some((part) => part.trim().startsWith(`${LOCALE_COOKIE_NAME}=`))) return readAppLocaleCookie(cookie);
  return acceptLanguageLocale(request.headers.get("accept-language"));
}

function readMessage(catalog: MessageCatalog, key: ServerMessageKey): string {
  if (key === "errors.sessionExpired") return catalog.errors.sessionExpired;
  const [, section, leaf] = key.split(".") as ["p1Server", keyof P1ServerMessages, string];
  return String((catalog.p1Server[section] as Record<string, string>)[leaf]);
}

export function messageForLocale(locale: AppLocale, key: ServerMessageKey, variables: MessageVariables = {}): string {
  const catalog = (locale === "ar" ? arMessages : enMessages) as MessageCatalog;
  return readMessage(catalog, key).replace(/\{(\w+)\}/g, (_, name: string) => String(variables[name] ?? `{${name}}`));
}

export function serverMessage(request: Request, key: ServerMessageKey, variables: MessageVariables = {}): string {
  return messageForLocale(resolveRequestLocale(request), key, variables);
}
