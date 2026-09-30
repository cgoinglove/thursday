export const LOCALES = ["en", "tr"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "thursday.locale";

/** What the app draws until someone picks: English, as before. */
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
};

export const isLocale = (value: unknown): value is Locale =>
  (LOCALES as readonly unknown[]).includes(value);

export const LOCALE_BOOT = `(function(){try{var l=localStorage.getItem(${JSON.stringify(
  LOCALE_STORAGE_KEY,
)})||${JSON.stringify(DEFAULT_LOCALE)};document.documentElement.setAttribute("lang",l)}catch(e){}})();`;
