import { describe, expect, it, vi } from "vitest";

import {
  verifyTrustedImage,
  type TrustedImageVerificationLimits,
} from "../src/media-verifier.js";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function png(
  width: number,
  height: number,
  extraChunks: readonly Buffer[] = [],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...extraChunks,
    pngChunk("IDAT", Buffer.from([0x78, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function staticWebp(width: number, height: number): Buffer {
  const lossless = Buffer.alloc(5);
  lossless[0] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  lossless.writeUInt32LE(bits >>> 0, 1);
  const chunk = Buffer.concat([
    Buffer.from("VP8L"),
    Buffer.from([5, 0, 0, 0]),
    lossless,
    Buffer.alloc(1),
  ]);
  const output = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
    chunk,
  ]);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

function animatedWebp(): Buffer {
  const extended = Buffer.alloc(10);
  extended[0] = 0x02;
  const chunk = Buffer.concat([
    Buffer.from("VP8X"),
    Buffer.from([10, 0, 0, 0]),
    extended,
  ]);
  const output = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
    chunk,
  ]);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

function structuralJpeg(width: number, height: number): Buffer {
  const frame = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);
  const scan = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00,
    0x3f, 0x00,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    frame,
    scan,
    Buffer.from([0x01, 0xff, 0xd9]),
  ]);
}

function body(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  const midpoint = Math.floor(bytes.byteLength / 2);
  const iterator = [bytes.subarray(0, midpoint), bytes.subarray(midpoint)][
    Symbol.iterator
  ]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
}

const limits: TrustedImageVerificationLimits = Object.freeze({
  maximumInputBytes: 2_000_000,
  maximumWidth: 4_096,
  maximumHeight: 4_096,
  maximumPixels: 16_000_000,
  maximumDecodedBytes: 64_000_000,
  maximumExpansionRatio: 100_000,
  requireDecodedVerification: false,
});

describe("trusted image media verifier", () => {
  it.each([
    ["image/png", png(2, 3), 2, 3],
    ["image/webp", staticWebp(5, 7), 5, 7],
    ["image/jpeg", structuralJpeg(11, 13), 11, 13],
  ] as const)(
    "fully hashes and structurally verifies one static %s object",
    async (mediaType, bytes, width, height) => {
      const result = await verifyTrustedImage({
        body: body(bytes),
        declaredMediaType: mediaType,
        limits,
        verificationProfileVersion: "image-structural-v1",
      });
      expect(result).toMatchObject({
        byteSize: String(bytes.length),
        detectedMediaType: mediaType,
        width,
        height,
        frameCount: 1,
        assurance: "structural_only",
      });
      expect(result.verificationResultHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    },
  );

  it("requires a pluggable full decoder for production profiles", async () => {
    const bytes = png(4, 6);
    await expect(
      verifyTrustedImage({
        body: body(bytes),
        limits: { ...limits, requireDecodedVerification: true },
        verificationProfileVersion: "image-production-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.decoder_required",
    });

    const verifyDecodedImage = vi.fn().mockResolvedValue({
      width: 4,
      height: 6,
      frameCount: 1,
    });
    await expect(
      verifyTrustedImage({
        body: body(bytes),
        limits: { ...limits, requireDecodedVerification: true },
        verificationProfileVersion: "image-production-v1",
        decodeVerifier: { verifyDecodedImage },
      }),
    ).resolves.toMatchObject({ assurance: "decoded" });
    expect(verifyDecodedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "image/png",
        structuralWidth: 4,
        structuralHeight: 6,
      }),
    );
  });

  it("rejects APNG and animated WebP before any decoder is invoked", async () => {
    const animationControl = Buffer.alloc(8);
    animationControl.writeUInt32BE(1, 0);
    animationControl.writeUInt32BE(0, 4);
    for (const bytes of [
      png(1, 1, [pngChunk("acTL", animationControl)]),
      animatedWebp(),
    ]) {
      await expect(
        verifyTrustedImage({
          body: body(bytes),
          limits,
          verificationProfileVersion: "image-static-v1",
        }),
      ).rejects.toMatchObject({
        code: "media_verification.animated_not_allowed",
      });
    }
  });

  it("rejects decoded multi-frame results and structural/decoded dimension mismatches", async () => {
    const bytes = png(8, 9);
    await expect(
      verifyTrustedImage({
        body: body(bytes),
        limits,
        verificationProfileVersion: "image-decoded-v1",
        decodeVerifier: {
          verifyDecodedImage: vi.fn().mockResolvedValue({
            width: 8,
            height: 9,
            frameCount: 2,
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "media_verification.animated_not_allowed",
    });
    await expect(
      verifyTrustedImage({
        body: body(bytes),
        limits,
        verificationProfileVersion: "image-decoded-v1",
        decodeVerifier: {
          verifyDecodedImage: vi.fn().mockResolvedValue({
            width: 7,
            height: 9,
            frameCount: 1,
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "media_verification.decode_mismatch",
    });
  });

  it("rejects truncated, checksum-corrupt, and declared-type-confused input", async () => {
    const valid = png(2, 2);
    const corrupt = Buffer.from(valid);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    await expect(
      verifyTrustedImage({
        body: body(valid.subarray(0, valid.length - 3)),
        limits,
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.truncated",
    });
    await expect(
      verifyTrustedImage({
        body: body(corrupt),
        limits,
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.malformed",
    });
    await expect(
      verifyTrustedImage({
        body: body(valid),
        declaredMediaType: "image/jpeg",
        limits,
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.declared_type_mismatch",
    });
  });

  it("enforces input, dimensions, pixels, decoded bytes, and expansion independently", async () => {
    const largeCanvas = png(1_000, 1_000);
    await expect(
      verifyTrustedImage({
        body: body(largeCanvas),
        limits: { ...limits, maximumWidth: 999 },
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.dimensions_exceeded",
    });
    await expect(
      verifyTrustedImage({
        body: body(largeCanvas),
        limits: { ...limits, maximumPixels: 999_999 },
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.pixels_exceeded",
    });
    await expect(
      verifyTrustedImage({
        body: body(largeCanvas),
        limits: { ...limits, maximumDecodedBytes: 3_999_999 },
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.decoded_size_exceeded",
    });
    await expect(
      verifyTrustedImage({
        body: body(largeCanvas),
        limits: { ...limits, maximumExpansionRatio: 10 },
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.expansion_ratio_exceeded",
    });
    await expect(
      verifyTrustedImage({
        body: body(png(1, 1)),
        limits: { ...limits, maximumInputBytes: 10 },
        verificationProfileVersion: "image-v1",
      }),
    ).rejects.toMatchObject({
      code: "media_verification.input_too_large",
    });
  });
});
