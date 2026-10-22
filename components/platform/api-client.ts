import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";

export type ApiLocale = "ar" | "en";
type ApiErrorCode = keyof typeof enMessages.platformAdmin.apiErrors;
type ApiErrorPayload = { error?: unknown; errorCode?: unknown; details?: unknown };

const LEGACY_ERROR_CODES: Record<string, ApiErrorCode> = {
  [arMessages.p1Server.legacyApi.forbiddenRequest]: "forbiddenRequest",
  [arMessages.p1Server.legacyApi.invalidInput]: "invalidInput",
  [arMessages.p1Server.legacyApi.invalidPlanData]: "invalidInput",
  [arMessages.p1Server.legacyApi.invalidProposalState]: "invalidInput",
  [arMessages.p1Server.legacyApi.proposalIdRequired]: "invalidInput",
  [arMessages.p1Server.legacyApi.unknownFeature]: "unknownFeature",
  [arMessages.p1Server.legacyApi.notFound]: "notFound",
  [enMessages.p1Server.legacyApi.forbiddenRequest]: "forbiddenRequest",
  [enMessages.p1Server.legacyApi.invalidInput]: "invalidInput",
  [enMessages.p1Server.legacyApi.invalidPlanData]: "invalidInput",
  [enMessages.p1Server.legacyApi.invalidProposalState]: "invalidInput",
  [enMessages.p1Server.legacyApi.proposalIdRequired]: "invalidInput",
  [enMessages.p1Server.legacyApi.unknownFeature]: "unknownFeature",
  [enMessages.p1Server.legacyApi.notFound]: "notFound",
};

export class ApiRequestError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details?: unknown, message = code) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function resolveApiLocale(language: string | undefined, cookie = ""): ApiLocale {
  if (language === "ar" || language === "en") return language;
  if (cookie.split(";").some((value) => value.trim() === "qutoof-locale=ar")) return "ar";
  return "en";
}

function currentLocale(): ApiLocale {
  return typeof document === "undefined" ? "en" : resolveApiLocale(document.documentElement.lang, document.cookie);
}

function errorCodeFor(payload: ApiErrorPayload, status: number): ApiErrorCode | null {
  if (typeof payload.errorCode === "string" && payload.errorCode in enMessages.platformAdmin.apiErrors) return payload.errorCode as ApiErrorCode;
  if (typeof payload.error === "string" && LEGACY_ERROR_CODES[payload.error]) return LEGACY_ERROR_CODES[payload.error];
  if (status === 403) return "forbiddenRequest";
  if (status === 400) return "invalidInput";
  if (status === 404) return "notFound";
  return null;
}

export function resolveApiErrorMessage(payload: ApiErrorPayload, status: number, locale: ApiLocale = currentLocale()): { message: string; code: string; details?: unknown } {
  const code = errorCodeFor(payload, status);
  const messages = locale === "ar" ? arMessages.platformAdmin.apiErrors : enMessages.platformAdmin.apiErrors;
  const message = code ? messages[code].replace("{status}", String(status)) : messages.httpError.replace("{status}", String(status));
  return { message, code: code ?? "httpError", details: payload.details ?? payload.error };
}

export async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as ApiErrorPayload & T;
  if (response.status === 401) {
    window.location.replace("/login");
    const locale = currentLocale();
    throw new ApiRequestError("sessionExpired", response.status, body.error, (locale === "ar" ? arMessages : enMessages).errors.sessionExpired);
  }
  if (response.status === 403) {
    window.location.replace("/dashboard");
    const failure = resolveApiErrorMessage(body, response.status);
    throw new ApiRequestError(failure.code, response.status, failure.details, failure.message);
  }
  if (!response.ok) {
    const failure = resolveApiErrorMessage(body, response.status);
    throw new ApiRequestError(failure.code, response.status, failure.details, failure.message);
  }
  return body;
}

export function formatDate(value: string | Date | null | undefined, locale: string = "en"): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const numberLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(numberLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(date);
}

export function formatMoney(minor: number, currency = "EGP", locale: string = "en"): string {
  const numberLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  return new Intl.NumberFormat(numberLocale, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}
