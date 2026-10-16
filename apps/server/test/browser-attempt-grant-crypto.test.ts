import { createHash } from "node:crypto";

import {
  createBrowserAttemptGrantCodec,
  type BrowserAttemptGrantEntropy,
} from "@kanvas/application/browser-execution";
import { describe, expect, it } from "vitest";

import { nodeBrowserAttemptGrantSha256 } from "../src/security/browser-attempt-grant-crypto.js";

const fixedEntropy = Object.freeze<BrowserAttemptGrantEntropy>({
  randomBytes(length) {
    expect(length).toBe(32);
    return Uint8Array.from({ length }, (_value, index) => index);
  },
});

describe("Node browser attempt-grant crypto adapter", () => {
  it("implements the application's exact domain-separated SHA-256 contract", () => {
    const codec = createBrowserAttemptGrantCodec({
      entropy: fixedEntropy,
      sha256: nodeBrowserAttemptGrantSha256,
    });

    const issued = codec.issue();
    const secret = Buffer.from(issued.rawGrant, "base64url");

    expect(issued.attemptGrantTokenHash).toBe(
      createHash("sha256")
        .update("kanvas:browser-grant:v1", "ascii")
        .update(secret)
        .digest("hex"),
    );
    expect(issued.domainLeaseTokenHash).toBe(
      createHash("sha256")
        .update("kanvas:attempt-lease:v1", "ascii")
        .update(secret)
        .digest("hex"),
    );
  });
});
