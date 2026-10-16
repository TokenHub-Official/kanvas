import { DomainError } from "../../foundation/domain-error.js";

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUES = new Map(
  [...BASE64URL_ALPHABET].map((character, index) => [character, index]),
);
const RAW_GRANT_BYTE_LENGTH = 32;
const RAW_GRANT_CHARACTER_LENGTH = 43;
const SHA256_BYTE_LENGTH = 32;
const CANONICAL_RAW_GRANT = /^[A-Za-z0-9_-]{43}$/u;
const GRANT_HASH_DOMAIN = asciiBytes("kanvas:browser-grant:v1");
const LEASE_HASH_DOMAIN = asciiBytes("kanvas:attempt-lease:v1");

declare const browserAttemptGrantBrand: unique symbol;

export type BrowserAttemptGrant = string & {
  readonly [browserAttemptGrantBrand]: true;
};

export interface BrowserAttemptGrantEntropy {
  /**
   * Returns a fresh, exclusively owned buffer. The codec zeroes it after use.
   */
  randomBytes(length: number): Uint8Array;
}

export interface BrowserAttemptGrantSha256 {
  digest(value: Uint8Array): Uint8Array;
}

export interface BrowserAttemptGrantDerivation {
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
}

export interface IssuedBrowserAttemptGrant extends BrowserAttemptGrantDerivation {
  /**
   * The only raw-secret hand-off. Callers must return it once to the assigned
   * executor and must never persist or log it.
   */
  readonly rawGrant: BrowserAttemptGrant;
}

export interface BrowserAttemptGrantCodec {
  issue(): IssuedBrowserAttemptGrant;
  parse(rawGrant: string): BrowserAttemptGrant;
  derive(rawGrant: string): BrowserAttemptGrantDerivation;
}

export interface CreateBrowserAttemptGrantCodecOptions {
  readonly entropy: BrowserAttemptGrantEntropy;
  readonly sha256: BrowserAttemptGrantSha256;
}

export type BrowserAttemptGrantErrorCode =
  "browser_attempt_grant.invalid" | "browser_attempt_grant.crypto_failure";

export class BrowserAttemptGrantError extends DomainError {
  public constructor(code: BrowserAttemptGrantErrorCode) {
    super(
      code,
      code === "browser_attempt_grant.invalid"
        ? "Invalid browser attempt grant."
        : "Browser attempt grant cryptography failed.",
    );
    this.name = "BrowserAttemptGrantError";
  }
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) {
      throw new Error("Attempt-grant hash domains must be ASCII.");
    }
    bytes[index] = code;
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const hasSecond = offset + 1 < bytes.length;
    const hasThird = offset + 2 < bytes.length;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;

    encoded += BASE64URL_ALPHABET[first >>> 2];
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | (second >>> 4)];
    if (hasSecond) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | (third >>> 6)];
    }
    if (hasThird) {
      encoded += BASE64URL_ALPHABET[third & 0x3f];
    }
  }
  return encoded;
}

function decodeCanonicalGrant(rawGrant: string): Uint8Array {
  if (
    typeof rawGrant !== "string" ||
    rawGrant.length !== RAW_GRANT_CHARACTER_LENGTH ||
    !CANONICAL_RAW_GRANT.test(rawGrant)
  ) {
    throw new BrowserAttemptGrantError("browser_attempt_grant.invalid");
  }

  const decoded = new Uint8Array(RAW_GRANT_BYTE_LENGTH);
  let accumulator = 0;
  let accumulatedBits = 0;
  let outputOffset = 0;

  for (const character of rawGrant) {
    const value = BASE64URL_VALUES.get(character);
    if (value === undefined) {
      throw new BrowserAttemptGrantError("browser_attempt_grant.invalid");
    }
    accumulator = (accumulator << 6) | value;
    accumulatedBits += 6;
    while (accumulatedBits >= 8) {
      accumulatedBits -= 8;
      if (outputOffset >= decoded.length) {
        throw new BrowserAttemptGrantError("browser_attempt_grant.invalid");
      }
      decoded[outputOffset] = (accumulator >>> accumulatedBits) & 0xff;
      outputOffset += 1;
      accumulator &= (1 << accumulatedBits) - 1;
    }
  }

  if (
    outputOffset !== RAW_GRANT_BYTE_LENGTH ||
    accumulator !== 0 ||
    encodeBase64Url(decoded) !== rawGrant
  ) {
    decoded.fill(0);
    throw new BrowserAttemptGrantError("browser_attempt_grant.invalid");
  }

  return decoded;
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function toHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }
  return value;
}

function hashForDomain(
  domain: Uint8Array,
  secret: Uint8Array,
  sha256: BrowserAttemptGrantSha256,
): string {
  const input = concatenate(domain, secret);
  try {
    const digest = sha256.digest(input);
    if (
      !(digest instanceof Uint8Array) ||
      digest.length !== SHA256_BYTE_LENGTH
    ) {
      throw new BrowserAttemptGrantError(
        "browser_attempt_grant.crypto_failure",
      );
    }
    return toHex(digest);
  } finally {
    input.fill(0);
  }
}

function deriveSecret(
  secret: Uint8Array,
  sha256: BrowserAttemptGrantSha256,
): BrowserAttemptGrantDerivation {
  return Object.freeze({
    attemptGrantTokenHash: hashForDomain(GRANT_HASH_DOMAIN, secret, sha256),
    domainLeaseTokenHash: hashForDomain(LEASE_HASH_DOMAIN, secret, sha256),
  });
}

function cryptoFailure(): BrowserAttemptGrantError {
  return new BrowserAttemptGrantError("browser_attempt_grant.crypto_failure");
}

function issuedGrant(
  rawGrant: BrowserAttemptGrant,
  derivation: BrowserAttemptGrantDerivation,
): IssuedBrowserAttemptGrant {
  const issued = {
    ...derivation,
  } as IssuedBrowserAttemptGrant;
  Object.defineProperty(issued, "rawGrant", {
    configurable: false,
    enumerable: false,
    value: rawGrant,
    writable: false,
  });
  return Object.freeze(issued);
}

export function createBrowserAttemptGrantCodec(
  options: CreateBrowserAttemptGrantCodecOptions,
): BrowserAttemptGrantCodec {
  return Object.freeze({
    issue(): IssuedBrowserAttemptGrant {
      let generated: Uint8Array | undefined;
      let secret: Uint8Array | undefined;
      try {
        generated = options.entropy.randomBytes(RAW_GRANT_BYTE_LENGTH);
        if (
          !(generated instanceof Uint8Array) ||
          generated.length !== RAW_GRANT_BYTE_LENGTH
        ) {
          throw cryptoFailure();
        }
        secret = new Uint8Array(generated);
        const rawGrant = encodeBase64Url(secret) as BrowserAttemptGrant;
        return issuedGrant(rawGrant, deriveSecret(secret, options.sha256));
      } catch {
        throw cryptoFailure();
      } finally {
        secret?.fill(0);
        generated?.fill(0);
      }
    },

    parse(rawGrant: string): BrowserAttemptGrant {
      let secret: Uint8Array | undefined;
      try {
        secret = decodeCanonicalGrant(rawGrant);
        return rawGrant as BrowserAttemptGrant;
      } finally {
        secret?.fill(0);
      }
    },

    derive(rawGrant: string): BrowserAttemptGrantDerivation {
      let secret: Uint8Array | undefined;
      try {
        secret = decodeCanonicalGrant(rawGrant);
        return deriveSecret(secret, options.sha256);
      } catch (error) {
        if (
          error instanceof BrowserAttemptGrantError &&
          error.code === "browser_attempt_grant.invalid"
        ) {
          throw error;
        }
        throw cryptoFailure();
      } finally {
        secret?.fill(0);
      }
    },
  });
}
