import { LOCALE_STORAGE_KEY } from "@/lib/i18n/locale-cookie";

export const THEME_SCRIPT = `
(function () {
  var root = document.documentElement;
  try {
    var stored = window.localStorage.getItem('qutoof-theme');
    var storedLocale = window.localStorage.getItem('${LOCALE_STORAGE_KEY}');
    var dark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var cookieLocale = document.cookie.split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf('qutoof-locale=') === 0; });
    var locale = storedLocale === 'en' || storedLocale === 'ar' ? storedLocale : (cookieLocale && cookieLocale.slice('qutoof-locale='.length) === 'en' ? 'en' : 'ar');
    var theme = dark ? 'dark' : 'light';
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
    root.setAttribute('data-theme', theme);
    root.setAttribute('lang', locale);
    root.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    root.style.colorScheme = theme;
    root.style.backgroundColor = dark ? '#0F172A' : '#F8FAFC';
  } catch (_) {
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
    root.setAttribute('lang', 'ar');
    root.setAttribute('dir', 'rtl');
    root.style.colorScheme = 'light';
    root.style.backgroundColor = '#F8FAFC';
  }
  window.requestAnimationFrame(function () {
    root.setAttribute('data-theme-ready', 'true');
  });
})();`;

export function ThemeScript() {
  return <script id="qutoof-theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
