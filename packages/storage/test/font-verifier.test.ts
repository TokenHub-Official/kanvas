import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { verifyTrustedFont } from "../src/font-verifier.js";

function trueTypeFixture(): Buffer {
  const tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "glyf", "loca"];
  const directoryEnd = 12 + tags.length * 16;
  const bytes = Buffer.alloc(directoryEnd + tags.length * 4);
  bytes.writeUInt32BE(0x0001_0000, 0);
  bytes.writeUInt16BE(tags.length, 4);
  tags.forEach((tag, index) => {
    const record = 12 + index * 16;
    const offset = directoryEnd + index * 4;
    bytes.write(tag, record, 4, "ascii");
    bytes.writeUInt32BE(offset, record + 8);
    bytes.writeUInt32BE(4, record + 12);
    bytes.writeUInt32BE(index + 1, offset);
  });
  return bytes;
}

describe("trusted font verifier", () => {
  it("accepts one bounded structurally complete TrueType font", async () => {
    const font = trueTypeFixture();
    const result = await verifyTrustedFont({
      body: Readable.from([font]),
      declaredMediaType: "font/ttf",
      maximumInputBytes: 1_048_576,
      verificationProfileVersion: "trusted-font-sfnt-v1",
    });
    expect(result).toMatchObject({
      byteSize: String(font.byteLength),
      detectedMediaType: "font/ttf",
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.verificationResultHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects mismatched declarations and incomplete table directories", async () => {
    await expect(
      verifyTrustedFont({
        body: Readable.from([trueTypeFixture()]),
        declaredMediaType: "font/otf",
        maximumInputBytes: 1_048_576,
        verificationProfileVersion: "trusted-font-sfnt-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.declared_type_mismatch",
    });
    const truncated = trueTypeFixture().subarray(0, 20);
    await expect(
      verifyTrustedFont({
        body: Readable.from([truncated]),
        declaredMediaType: "font/ttf",
        maximumInputBytes: 1_048_576,
        verificationProfileVersion: "trusted-font-sfnt-v1",
      }),
    ).rejects.toMatchObject({ code: "media_verification.truncated" });
  });
});
