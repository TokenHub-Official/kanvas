import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyOpaqueModelResource } from "../src/model-resource-verifier.js";

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

describe("opaque Model Resource verifier", () => {
  it("streams bounded bytes and records canonical identity", async () => {
    const bytes = new TextEncoder().encode("model-resource");
    await expect(
      verifyOpaqueModelResource({
        body: chunks(bytes.subarray(0, 5), bytes.subarray(5)),
        declaredMediaType: "application/octet-stream",
        maximumInputBytes: 1024,
        verificationProfileVersion: "model-resource-binary-v1",
      }),
    ).resolves.toMatchObject({
      byteSize: String(bytes.byteLength),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      detectedMediaType: "application/octet-stream",
    });
  });

  it("rejects empty and oversized bodies", async () => {
    await expect(
      verifyOpaqueModelResource({
        body: chunks(),
        maximumInputBytes: 10,
        verificationProfileVersion: "model-resource-binary-v1",
      }),
    ).rejects.toThrow(/empty/u);
    await expect(
      verifyOpaqueModelResource({
        body: chunks(new Uint8Array(11)),
        maximumInputBytes: 10,
        verificationProfileVersion: "model-resource-binary-v1",
      }),
    ).rejects.toThrow(/byte limit/u);
  });
});
