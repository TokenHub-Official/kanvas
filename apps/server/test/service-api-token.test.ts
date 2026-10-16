import { describe, expect, it } from "vitest";

import {
  digestServiceApiToken,
  readBearerToken,
  ServiceApiTokenFormatError,
} from "../src/security/service-api-token.js";

describe("Service API token Authentication Adapter", () => {
  const token = `kvs_${"a".repeat(48)}`;

  it("uses a stable domain-separated digest without retaining raw material", () => {
    expect(digestServiceApiToken(token)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(digestServiceApiToken(token)).not.toContain(token);
    expect(digestServiceApiToken(token)).not.toBe(
      digestServiceApiToken(`kvs_${"b".repeat(48)}`),
    );
  });

  it("accepts one strict Bearer value and rejects ambiguous syntax", () => {
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(undefined)).toBeUndefined();
    expect(() => readBearerToken(`bearer ${token}`)).toThrow(
      ServiceApiTokenFormatError,
    );
    expect(() => readBearerToken(`Bearer ${token} extra`)).toThrow(
      ServiceApiTokenFormatError,
    );
  });
});
