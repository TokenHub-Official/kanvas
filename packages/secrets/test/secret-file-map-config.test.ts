import { describe, expect, it } from "vitest";
import { loadProviderSecretFileMaps } from "../src/secret-file-map-config.js";

describe("environment KEK map validation", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  it("does not resolve inherited object properties as configured KEK versions", () => {
    const empty = loadProviderSecretFileMaps({});
    expect(empty.kekFiles.constructor).toBeUndefined();
    expect(empty.kekValues?.constructor).toBeUndefined();
    const configured = loadProviderSecretFileMaps({
      KANVAS_PROVIDER_KEK_MAP_JSON: JSON.stringify({ v1: key }),
    });
    expect(configured.kekValues?.v1).toBe(key);
    expect(Reflect.get(configured.kekValues ?? {}, "toString")).toBeUndefined();
  });
  it("rejects malformed or ambiguous configuration without echoing material", () => {
    for (const value of [
      "not-json-secret",
      "[]",
      JSON.stringify({ v1: "invalid-secret" }),
    ]) {
      try {
        loadProviderSecretFileMaps({ KANVAS_PROVIDER_KEK_MAP_JSON: value });
        throw new Error("Expected rejection");
      } catch (error) {
        expect(String(error)).toContain("Invalid KANVAS_PROVIDER_KEK_MAP_JSON");
        expect(String(error)).not.toContain(value);
        expect(error).not.toHaveProperty("cause");
      }
    }
    expect(() =>
      loadProviderSecretFileMaps({
        KANVAS_PROVIDER_KEK_MAP_JSON: JSON.stringify({ v1: key }),
        KANVAS_PROVIDER_KEK_MAP_FILE: "/unused",
      }),
    ).toThrow(/only one/u);
  });
});
