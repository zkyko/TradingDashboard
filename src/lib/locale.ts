export const LOCALES = ["en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Locales that render right-to-left. Stubbed for future ar/he/fa/ur expansion. */
export const RTL_LOCALES = new Set<string>(["ar", "he", "fa", "ur"]);

const BCP47: Record<string, string> = {
  en: "en-US",
  ar: "ar-SA",
  he: "he-IL",
  fa: "fa-IR",
  ur: "ur-PK",
};

export function isAppLocale(value: string): value is AppLocale {
  return (LOCALES as readonly string[]).includes(value);
}

export function toBcp47(locale: string): string {
  return BCP47[locale] || "en-US";
}

export function getLocaleDir(locale: string): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function localeLabel(locale: string): string {
  if (locale === "en") return "English";
  return locale.toUpperCase();
}

export function localePath(locale: string, href: string): string {
  if (!href.startsWith("/")) return href;
  if (href === "/") return `/${locale}`;
  return `/${locale}${href}`;
}
