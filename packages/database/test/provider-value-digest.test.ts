import { describe, expect, it } from "vitest";

import {
  canonicalizeProviderValue,
  digestProviderValue,
  ProviderValueCanonicalizationError,
} from "../src/runtime/provider-value-digest.js";

describe("Provider value canonical JSON authority", () => {
  it("uses stable locale-independent ordering for mixed-case and Unicode keys", () => {
    const left = {
      "😀": "emoji",
      中: "cjk",
      a: "lower",
      é: "accent",
      Z: "upper-z",
      A: "upper-a",
    };
    const right = {
      é: "accent",
      A: "upper-a",
      中: "cjk",
      Z: "upper-z",
      "😀": "emoji",
      a: "lower",
    };
    const expected =
      '{"A":"upper-a","Z":"upper-z","a":"lower","é":"accent","中":"cjk","😀":"emoji"}';

    expect(canonicalizeProviderValue(left)).toBe(expected);
    expect(canonicalizeProviderValue(right)).toBe(expected);
    expect(digestProviderValue(left)).toBe(
      "sha256:850df62febb265baf3ac9d270247454c4060b2d0197526227a854397478e94bb",
    );
    expect(digestProviderValue(right)).toBe(digestProviderValue(left));
  });

  it.each([
    {
      name: "undefined object field",
      value: {
        accepted: true,
        missing: undefined,
      },
      reason: "undefined",
    },
    {
      name: "undefined array item",
      value: [true, undefined],
      reason: "undefined",
    },
    {
      name: "sparse array item",
      value: new Array(1),
      reason: "undefined",
    },
  ])(
    "rejects $name instead of silently changing bytes",
    ({ value, reason }) => {
      expect(() => canonicalizeProviderValue(value)).toThrowError(
        expect.objectContaining({
          name: "ProviderValueCanonicalizationError",
          code: "provider_value.not_canonical_json",
          reason,
        }),
      );
    },
  );

  it.each([
    {
      name: "Date",
      value: new Date("2026-07-27T12:00:00.000Z"),
    },
    {
      name: "class instance",
      value: new (class ProviderOutput {
        public readonly artifactId = "artifact-1";
      })(),
    },
  ])("rejects a non-plain $name", ({ value }) => {
    expect(() => digestProviderValue(value)).toThrowError(
      expect.objectContaining({
        name: "ProviderValueCanonicalizationError",
        reason: "non_plain_object",
      }),
    );
  });

  it("rejects cyclic objects and arrays without recursive overflow", () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);

    for (const value of [object, array]) {
      expect(() => canonicalizeProviderValue(value)).toThrowError(
        expect.objectContaining({
          name: "ProviderValueCanonicalizationError",
          reason: "cycle",
        }),
      );
    }
  });

  it("allows repeated acyclic references and null-prototype JSON objects", () => {
    const shared = {
      artifactId: "artifact-1",
    };
    const nullPrototype = Object.assign(
      Object.create(null) as Record<string, unknown>,
      {
        second: shared,
        first: shared,
      },
    );

    expect(canonicalizeProviderValue(nullPrototype)).toBe(
      '{"first":{"artifactId":"artifact-1"},"second":{"artifactId":"artifact-1"}}',
    );
    expect(() => canonicalizeProviderValue(nullPrototype)).not.toThrowError(
      ProviderValueCanonicalizationError,
    );
  });
});
