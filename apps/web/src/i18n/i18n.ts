import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  resources,
  supportedLocaleDefinitions,
  supportedLocales,
  type ProductLocale,
} from "./resources.js";

export const productLocalePreferenceKey = "kanvas:product-locale";

interface LocalePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isProductLocale(
  value: string | null | undefined,
): value is ProductLocale {
  return supportedLocales.some((locale) => locale === value);
}

export function readProductLocalePreference(
  storage: LocalePreferenceStorage | undefined,
): ProductLocale | undefined {
  if (!storage) return undefined;
  try {
    const value = storage.getItem(productLocalePreferenceKey);
    return isProductLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeProductLocalePreference(
  storage: LocalePreferenceStorage | undefined,
  locale: ProductLocale,
): void {
  if (!storage) return;
  try {
    storage.setItem(productLocalePreferenceKey, locale);
  } catch {
    /* Optional device preference. */
  }
}

function browserPreferenceStorage(): LocalePreferenceStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function resolveProductLocale(
  languages: readonly string[],
  storedPreference?: string | null,
): ProductLocale {
  if (isProductLocale(storedPreference)) return storedPreference;
  for (const language of languages) {
    const browserLanguage = language.trim().toLowerCase().split(/[-_]/u)[0];
    const definition = supportedLocaleDefinitions.find(
      (candidate) => candidate.browserLanguage === browserLanguage,
    );
    if (definition) return definition.locale;
  }
  return supportedLocaleDefinitions[0].locale;
}

const preferenceStorage = browserPreferenceStorage();
const initialLocale = resolveProductLocale(
  typeof navigator === "undefined" ? ["zh-CN"] : navigator.languages,
  readProductLocalePreference(preferenceStorage),
);

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: "zh-CN",
    supportedLngs: supportedLocales,
    load: "currentOnly",
    interpolation: {
      escapeValue: false,
    },
    initAsync: false,
  });
}

export function selectProductLocale(locale: ProductLocale): void {
  writeProductLocalePreference(browserPreferenceStorage(), locale);
  void i18n.changeLanguage(locale);
}

export { i18n };
