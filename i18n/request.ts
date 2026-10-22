import { getRequestConfig } from "next-intl/server";
import arMessages from "../messages/ar.json";
import enMessages from "../messages/en.json";
import { getServerLocale } from "../lib/i18n/server-locale";

export default getRequestConfig(async () => {
  const locale = await getServerLocale();
  return {
    locale,
    messages: locale === "ar" ? arMessages : enMessages,
  };
});
