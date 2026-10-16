import { describe, expect, it } from "vitest";

import {
  productLocalePreferenceKey,
  readProductLocalePreference,
  resolveProductLocale,
  writeProductLocalePreference,
} from "./i18n.js";
import {
  resources,
  supportedLocaleDefinitions,
  supportedLocales,
} from "./resources.js";

function flattenKeys(value: unknown, prefix = ""): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function localeMessageKeys(
  value: unknown,
  locale: string,
  referenceKeys: readonly string[],
): readonly string[] {
  const keys = flattenKeys(value);
  const pluralSuffix = /_(zero|one|two|few|many|other)$/u;
  // Literal suffixes (for example a status named released_other) remain exact keys.
  // Only a base message in the reference locale declares a pluralized counterpart.
  const pluralBases = new Set(
    keys
      .filter(
        (key) =>
          pluralSuffix.test(key) &&
          referenceKeys.includes(key.replace(pluralSuffix, "")),
      )
      .map((key) => key.replace(pluralSuffix, "")),
  );
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories;
  for (const base of pluralBases) {
    for (const category of categories) {
      expect(
        keys,
        `${locale}: missing plural form ${base}_${category}`,
      ).toContain(`${base}_${category}`);
    }
  }
  return [
    ...new Set(
      keys.map((key) =>
        pluralBases.has(key.replace(pluralSuffix, ""))
          ? key.replace(pluralSuffix, "")
          : key,
      ),
    ),
  ].toSorted();
}

describe("product locale resources", () => {
  it("keeps every supported locale key-complete", () => {
    const reference = flattenKeys(resources["zh-CN"].translation).toSorted();

    for (const locale of supportedLocales) {
      expect(
        localeMessageKeys(resources[locale].translation, locale, reference),
      ).toEqual(reference);
    }
  });

  it("validates plural forms while preserving literal suffix keys", () => {
    expect(
      localeMessageKeys({ count_one: "one", count_other: "many" }, "en-US", [
        "count",
      ]),
    ).toEqual(localeMessageKeys({ count: "数量" }, "zh-CN", ["count"]));
    expect(() =>
      localeMessageKeys({ count_other: "many" }, "en-US", ["count"]),
    ).toThrow();
    expect(
      localeMessageKeys({ released_other: "other" }, "en-US", [
        "released_other",
      ]),
    ).toEqual(["released_other"]);
  });

  it("provides a localized menu label for every supported language", () => {
    for (const displayLocale of supportedLocales) {
      const labels =
        resources[displayLocale].translation.common.appShell.account.languages;
      for (const { locale } of supportedLocaleDefinitions) {
        expect(labels[locale]).toBeTruthy();
      }
    }
  });

  it("selects the first supported language in browser preference order", () => {
    expect(resolveProductLocale(["zh-TW", "en-GB"])).toBe("zh-CN");
    expect(resolveProductLocale(["ja-JP", "en-GB", "zh-TW"])).toBe("en-US");
    expect(resolveProductLocale(["ja-JP"])).toBe(
      supportedLocaleDefinitions[0].locale,
    );
  });

  it("uses a valid saved locale before browser preferences", () => {
    expect(resolveProductLocale(["zh-CN"], "en-US")).toBe("en-US");
    expect(resolveProductLocale(["en-US"], "fr-FR")).toBe("en-US");
  });

  it("round-trips only supported locale preferences", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeProductLocalePreference(storage, "en-US");
    expect(values.get(productLocalePreferenceKey)).toBe("en-US");
    expect(readProductLocalePreference(storage)).toBe("en-US");

    values.set(productLocalePreferenceKey, "fr-FR");
    expect(readProductLocalePreference(storage)).toBeUndefined();
  });
});
