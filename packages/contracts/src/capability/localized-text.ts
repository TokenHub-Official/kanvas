import { Type, type Static } from "@sinclair/typebox";

export const LocalizedTextV1Schema = Type.Object(
  {
    defaultLocale: Type.String({
      minLength: 2,
      maxLength: 35,
      pattern: "^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$",
    }),
    values: Type.Record(
      Type.String({
        minLength: 2,
        maxLength: 35,
        pattern: "^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$",
      }),
      Type.String({ minLength: 1, maxLength: 1_000 }),
      { minProperties: 1, maxProperties: 64 },
    ),
  },
  { additionalProperties: false },
);

export type LocalizedTextV1 = Static<typeof LocalizedTextV1Schema>;

export function resolveLocalizedTextV1(
  text: LocalizedTextV1,
  locale: string,
): string {
  const exact = text.values[locale];
  if (exact) return exact;
  const language = locale.split("-", 1)[0]?.toLowerCase();
  if (language) {
    const match = Object.entries(text.values).find(
      ([candidate]) => candidate.split("-", 1)[0]?.toLowerCase() === language,
    );
    if (match) return match[1];
  }
  return (
    text.values[text.defaultLocale] ??
    Object.values(text.values)[0] ??
    text.defaultLocale
  );
}
