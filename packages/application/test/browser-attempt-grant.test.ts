import { describe, expect, it } from "vitest";

import {
  BrowserAttemptGrantError,
  createBrowserAttemptGrantCodec,
  type BrowserAttemptGrantEntropy,
  type BrowserAttemptGrantSha256,
} from "../src/modules/browser-execution/index.js";

class DeterministicEntropy implements BrowserAttemptGrantEntropy {
  readonly #values: Uint8Array[];

  public constructor(...values: Uint8Array[]) {
    this.#values = values.map((value) => new Uint8Array(value));
  }

  public randomBytes(length: number): Uint8Array {
    const value = this.#values.shift();
    if (!value || value.length !== length) {
      throw new Error("No deterministic entropy value is available.");
    }
    return value;
  }
}

const deterministicSha256: BrowserAttemptGrantSha256 = {
  digest(value) {
    const output = new Uint8Array(32);
    for (let index = 0; index < value.length; index += 1) {
      const byte = value[index] ?? 0;
      const firstOffset = index % output.length;
      const secondOffset = (index * 11 + 7) % output.length;
      output[firstOffset] =
        ((output[firstOffset] ?? 0) + byte + index * 17) & 0xff;
      output[secondOffset] =
        (output[secondOffset] ?? 0) ^ ((byte + index * 29) & 0xff);
    }
    return output;
  },
};

function codecFor(...secrets: Uint8Array[]) {
  return createBrowserAttemptGrantCodec({
    entropy: new DeterministicEntropy(...secrets),
    sha256: deterministicSha256,
  });
}

describe("BrowserAttemptGrantCodec", () => {
  it("issues one canonical 256-bit opaque grant and domain-separated hashes", () => {
    const secret = Uint8Array.from({ length: 32 }, (_value, index) => index);
    const codec = codecFor(secret);

    const issued = codec.issue();

    expect(issued.rawGrant).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.attemptGrantTokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(issued.domainLeaseTokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(issued.attemptGrantTokenHash).not.toBe(issued.domainLeaseTokenHash);
    expect(codec.derive(issued.rawGrant)).toEqual({
      attemptGrantTokenHash: issued.attemptGrantTokenHash,
      domainLeaseTokenHash: issued.domainLeaseTokenHash,
    });
    expect(codec.parse(issued.rawGrant)).toBe(issued.rawGrant);
    expect(JSON.stringify(issued)).not.toContain(issued.rawGrant);
    expect(Object.keys(issued)).not.toContain("rawGrant");
  });

  it("changes both derived hashes when one secret bit changes", () => {
    const firstSecret = new Uint8Array(32);
    const secondSecret = new Uint8Array(32);
    secondSecret[0] = 1;
    const codec = codecFor(firstSecret, secondSecret);

    const first = codec.issue();
    const second = codec.issue();

    expect(first.rawGrant).not.toBe(second.rawGrant);
    expect(first.attemptGrantTokenHash).not.toBe(second.attemptGrantTokenHash);
    expect(first.domainLeaseTokenHash).not.toBe(second.domainLeaseTokenHash);
  });

  it("zeroes the owned entropy buffer after issuing", () => {
    const generated = new Uint8Array(32).fill(0xa5);
    const codec = createBrowserAttemptGrantCodec({
      entropy: {
        randomBytes() {
          return generated;
        },
      },
      sha256: deterministicSha256,
    });

    codec.issue();

    expect(generated).toEqual(new Uint8Array(32));
  });

  it.each([
    ["padding", `${"A".repeat(43)}=`],
    ["standard base64 alphabet", `${"A".repeat(42)}+`],
    ["wrong length", "A".repeat(42)],
    ["non-canonical trailing bits", `${"A".repeat(42)}B`],
  ])("rejects %s without echoing the candidate", (_label, candidate) => {
    const codec = codecFor();

    expect(() => codec.parse(candidate)).toThrowError(
      expect.objectContaining({
        code: "browser_attempt_grant.invalid",
        message: "Invalid browser attempt grant.",
      }),
    );
    try {
      codec.parse(candidate);
    } catch (error) {
      expect(String(error)).not.toContain(candidate);
    }
  });

  it("redacts a raw grant even when the injected hash adapter leaks it", () => {
    const issuingCodec = codecFor(new Uint8Array(32).fill(0xa5));
    const rawGrant = issuingCodec.issue().rawGrant;
    const leakingCodec = createBrowserAttemptGrantCodec({
      entropy: new DeterministicEntropy(),
      sha256: {
        digest() {
          throw new Error(`adapter leaked ${rawGrant}`);
        },
      },
    });

    let observed: unknown;
    try {
      leakingCodec.derive(rawGrant);
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(BrowserAttemptGrantError);
    expect(observed).toMatchObject({
      code: "browser_attempt_grant.crypto_failure",
      message: "Browser attempt grant cryptography failed.",
    });
    expect(String(observed)).not.toContain(rawGrant);
    expect(observed).not.toHaveProperty("cause");
  });

  it("fails closed when entropy or digest output is not exactly 256 bits", () => {
    const shortEntropyCodec = createBrowserAttemptGrantCodec({
      entropy: {
        randomBytes: () => new Uint8Array(31),
      },
      sha256: deterministicSha256,
    });
    const shortDigestCodec = createBrowserAttemptGrantCodec({
      entropy: new DeterministicEntropy(new Uint8Array(32)),
      sha256: {
        digest: () => new Uint8Array(31),
      },
    });

    expect(() => shortEntropyCodec.issue()).toThrowError(
      expect.objectContaining({
        code: "browser_attempt_grant.crypto_failure",
      }),
    );
    expect(() => shortDigestCodec.issue()).toThrowError(
      expect.objectContaining({
        code: "browser_attempt_grant.crypto_failure",
      }),
    );
  });
});
