import { createHash } from "node:crypto";

import type { DecodeVerifier } from "@kanvas/application";

export type TrustedImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export type MediaVerificationErrorCode =
  | "media_verification.invalid_configuration"
  | "media_verification.input_too_large"
  | "media_verification.unsupported_media"
  | "media_verification.declared_type_mismatch"
  | "media_verification.malformed"
  | "media_verification.truncated"
  | "media_verification.animated_not_allowed"
  | "media_verification.dimensions_exceeded"
  | "media_verification.pixels_exceeded"
  | "media_verification.decoded_size_exceeded"
  | "media_verification.expansion_ratio_exceeded"
  | "media_verification.decoder_required"
  | "media_verification.decode_failed"
  | "media_verification.decode_mismatch";

export class MediaVerificationError extends Error {
  constructor(
    readonly code: MediaVerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MediaVerificationError";
  }
}

export interface TrustedImageVerificationLimits {
  readonly maximumInputBytes: number;
  readonly maximumWidth: number;
  readonly maximumHeight: number;
  readonly maximumPixels: number;
  readonly maximumDecodedBytes: number;
  readonly maximumExpansionRatio: number;
  readonly requireDecodedVerification: boolean;
}

export interface VerifyTrustedImageRequest {
  readonly body: AsyncIterable<Uint8Array>;
  readonly declaredMediaType?: TrustedImageMediaType;
  readonly limits: TrustedImageVerificationLimits;
  readonly verificationProfileVersion: string;
  readonly decodeVerifier?: DecodeVerifier;
}

export interface TrustedImageVerificationResult {
  readonly byteSize: string;
  readonly sha256: string;
  readonly detectedMediaType: TrustedImageMediaType;
  readonly width: number;
  readonly height: number;
  readonly frameCount: 1;
  readonly estimatedDecodedBytes: string;
  readonly assurance: "structural_only" | "decoded";
  readonly verificationResultHash: string;
}

interface StructuralImageFacts {
  readonly mediaType: TrustedImageMediaType;
  readonly width: number;
  readonly height: number;
  readonly estimatedDecodedBytes: number;
}

function fail(
  code: MediaVerificationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new MediaVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "media_verification.invalid_configuration",
      `${label} must be a positive safe integer.`,
    );
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function assertLimits(
  limits: TrustedImageVerificationLimits,
  profileVersion: string,
): void {
  assertPositiveSafeInteger(limits.maximumInputBytes, "Maximum input bytes");
  assertPositiveSafeInteger(limits.maximumWidth, "Maximum width");
  assertPositiveSafeInteger(limits.maximumHeight, "Maximum height");
  assertPositiveSafeInteger(limits.maximumPixels, "Maximum pixels");
  assertPositiveSafeInteger(
    limits.maximumDecodedBytes,
    "Maximum decoded bytes",
  );
  if (
    !Number.isFinite(limits.maximumExpansionRatio) ||
    limits.maximumExpansionRatio <= 0
  ) {
    fail(
      "media_verification.invalid_configuration",
      "Maximum expansion ratio must be finite and positive.",
    );
  }
  if (
    profileVersion.length < 1 ||
    profileVersion.length > 120 ||
    hasControlCharacter(profileVersion)
  ) {
    fail(
      "media_verification.invalid_configuration",
      "Verification profile version is invalid.",
    );
  }
}

async function collectBoundedInput(
  body: AsyncIterable<Uint8Array>,
  maximumInputBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      fail(
        "media_verification.malformed",
        "Media body yielded a non-byte chunk.",
      );
    }
    byteSize += chunk.byteLength;
    if (byteSize > maximumInputBytes) {
      fail(
        "media_verification.input_too_large",
        "Media input exceeds its bounded verification allocation.",
      );
    }
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return Buffer.concat(chunks, byteSize);
}

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

function checkedDecodedBytes(pixels: number, bytesPerPixel: number): number {
  const decoded = pixels * bytesPerPixel;
  if (!Number.isSafeInteger(decoded)) {
    fail(
      "media_verification.decoded_size_exceeded",
      "Estimated decoded media size is not safely representable.",
    );
  }
  return decoded;
}

function parsePng(bytes: Buffer): StructuralImageFacts {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    bytes.length < signature.length ||
    !bytes.subarray(0, signature.length).equals(signature)
  ) {
    fail("media_verification.unsupported_media", "Media is not a PNG object.");
  }
  let position = signature.length;
  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let colorType: number | undefined;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  while (position < bytes.length) {
    if (bytes.length - position < 12) {
      fail("media_verification.truncated", "PNG chunk header is truncated.");
    }
    const length = bytes.readUInt32BE(position);
    const typeStart = position + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      fail("media_verification.truncated", "PNG chunk payload is truncated.");
    }
    const typeBytes = bytes.subarray(typeStart, dataStart);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type) || /[a-z]/u.test(type[2] ?? "")) {
      fail("media_verification.malformed", "PNG chunk type is invalid.");
    }
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (crc32(bytes.subarray(typeStart, dataEnd)) !== expectedCrc) {
      fail("media_verification.malformed", "PNG chunk checksum is invalid.");
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      fail(
        "media_verification.animated_not_allowed",
        "Animated PNG objects are not accepted.",
      );
    }
    if (position === signature.length && type !== "IHDR") {
      fail("media_verification.malformed", "PNG IHDR must be the first chunk.");
    }
    if (type === "IHDR") {
      if (width !== undefined || length !== 13) {
        fail(
          "media_verification.malformed",
          "PNG contains an invalid or duplicate IHDR.",
        );
      }
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      const validDepths: Readonly<Record<number, readonly number[]>> =
        Object.freeze({
          0: Object.freeze([1, 2, 4, 8, 16]),
          2: Object.freeze([8, 16]),
          3: Object.freeze([1, 2, 4, 8]),
          4: Object.freeze([8, 16]),
          6: Object.freeze([8, 16]),
        });
      if (
        width === 0 ||
        height === 0 ||
        bitDepth === undefined ||
        colorType === undefined ||
        !validDepths[colorType]?.includes(bitDepth) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        fail("media_verification.malformed", "PNG image header is invalid.");
      }
    } else if (type === "PLTE") {
      if (
        sawImageData ||
        sawPalette ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        fail("media_verification.malformed", "PNG palette chunk is invalid.");
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (width === undefined || imageDataEnded) {
        fail(
          "media_verification.malformed",
          "PNG image data chunks are out of order.",
        );
      }
      sawImageData = true;
    } else {
      if (sawImageData) {
        imageDataEnded = true;
      }
      if (type === "IEND") {
        if (length !== 0 || !sawImageData) {
          fail(
            "media_verification.malformed",
            "PNG terminal chunk is invalid.",
          );
        }
        sawEnd = true;
        position = chunkEnd;
        if (position !== bytes.length) {
          fail(
            "media_verification.malformed",
            "PNG contains trailing data after IEND.",
          );
        }
        break;
      }
      if ((typeBytes[0] ?? 0) >= 0x41 && (typeBytes[0] ?? 0) <= 0x5a) {
        fail(
          "media_verification.malformed",
          "PNG contains an unknown critical chunk.",
        );
      }
    }
    position = chunkEnd;
  }
  if (
    !sawEnd ||
    width === undefined ||
    height === undefined ||
    bitDepth === undefined ||
    colorType === undefined ||
    (colorType === 3 && !sawPalette)
  ) {
    fail("media_verification.truncated", "PNG structure is incomplete.");
  }
  let channels = 4;
  if (colorType === 0 || colorType === 3) {
    channels = 1;
  } else if (colorType === 2) {
    channels = 3;
  } else if (colorType === 4) {
    channels = 2;
  }
  const nativeBytesPerPixel = channels * (bitDepth === 16 ? 2 : 1);
  const pixels = width * height;
  return Object.freeze({
    mediaType: "image/png",
    width,
    height,
    estimatedDecodedBytes: checkedDecodedBytes(
      pixels,
      Math.max(4, nativeBytesPerPixel),
    ),
  });
}

function readUint24LittleEndian(bytes: Buffer, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function parseWebp(bytes: Buffer): StructuralImageFacts {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    fail("media_verification.unsupported_media", "Media is not a WebP object.");
  }
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize + 8 !== bytes.length) {
    fail(
      riffSize + 8 > bytes.length
        ? "media_verification.truncated"
        : "media_verification.malformed",
      "WebP RIFF size does not match the complete object.",
    );
  }
  let position = 12;
  let extendedWidth: number | undefined;
  let extendedHeight: number | undefined;
  let primaryWidth: number | undefined;
  let primaryHeight: number | undefined;
  let sawExtendedHeader = false;
  let sawPrimary = false;
  let chunkIndex = 0;
  while (position < bytes.length) {
    if (bytes.length - position < 8) {
      fail("media_verification.truncated", "WebP chunk header is truncated.");
    }
    const type = bytes.toString("ascii", position, position + 4);
    const length = bytes.readUInt32LE(position + 4);
    const dataStart = position + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (
      !/^[\x20-\x7e]{4}$/u.test(type) ||
      !Number.isSafeInteger(paddedEnd) ||
      paddedEnd > bytes.length
    ) {
      fail(
        paddedEnd > bytes.length
          ? "media_verification.truncated"
          : "media_verification.malformed",
        "WebP chunk is invalid or truncated.",
      );
    }
    if (length % 2 === 1 && (bytes[paddedEnd - 1] ?? 0) !== 0) {
      fail(
        "media_verification.malformed",
        "WebP chunk padding byte must be zero.",
      );
    }
    if (type === "ANIM" || type === "ANMF") {
      fail(
        "media_verification.animated_not_allowed",
        "Animated WebP objects are not accepted.",
      );
    }
    if (type === "VP8X") {
      if (sawExtendedHeader || chunkIndex !== 0 || length !== 10) {
        fail(
          "media_verification.malformed",
          "WebP extended header is invalid or misplaced.",
        );
      }
      const flags = bytes[dataStart] ?? 0;
      if ((flags & 0xc3) !== 0) {
        fail(
          (flags & 0x02) !== 0
            ? "media_verification.animated_not_allowed"
            : "media_verification.malformed",
          "WebP extended header has invalid or animated flags.",
        );
      }
      if (
        (bytes[dataStart + 1] ?? 0) !== 0 ||
        (bytes[dataStart + 2] ?? 0) !== 0 ||
        (bytes[dataStart + 3] ?? 0) !== 0
      ) {
        fail(
          "media_verification.malformed",
          "WebP extended header reserved bytes are non-zero.",
        );
      }
      extendedWidth = readUint24LittleEndian(bytes, dataStart + 4) + 1;
      extendedHeight = readUint24LittleEndian(bytes, dataStart + 7) + 1;
      sawExtendedHeader = true;
    } else if (type === "VP8 ") {
      if (sawPrimary || length < 10) {
        fail(
          "media_verification.malformed",
          "WebP contains an invalid or duplicate lossy frame.",
        );
      }
      const frameTag =
        (bytes[dataStart] ?? 0) |
        ((bytes[dataStart + 1] ?? 0) << 8) |
        ((bytes[dataStart + 2] ?? 0) << 16);
      const codecVersion = (frameTag >>> 1) & 0x07;
      const showFrame = (frameTag >>> 4) & 0x01;
      const firstPartitionBytes = frameTag >>> 5;
      if (
        (frameTag & 1) !== 0 ||
        codecVersion > 3 ||
        showFrame !== 1 ||
        firstPartitionBytes > length - 10 ||
        (bytes[dataStart + 3] ?? 0) !== 0x9d ||
        (bytes[dataStart + 4] ?? 0) !== 0x01 ||
        (bytes[dataStart + 5] ?? 0) !== 0x2a
      ) {
        fail(
          "media_verification.malformed",
          "WebP lossy key-frame header is invalid.",
        );
      }
      primaryWidth = bytes.readUInt16LE(dataStart + 6) & 0x3fff;
      primaryHeight = bytes.readUInt16LE(dataStart + 8) & 0x3fff;
      sawPrimary = true;
    } else if (type === "VP8L") {
      if (sawPrimary || length < 5 || (bytes[dataStart] ?? 0) !== 0x2f) {
        fail(
          "media_verification.malformed",
          "WebP contains an invalid or duplicate lossless frame.",
        );
      }
      const bits = bytes.readUInt32LE(dataStart + 1);
      if (bits >>> 29 !== 0) {
        fail(
          "media_verification.malformed",
          "WebP lossless header version is unsupported.",
        );
      }
      primaryWidth = (bits & 0x3fff) + 1;
      primaryHeight = ((bits >>> 14) & 0x3fff) + 1;
      sawPrimary = true;
    }
    position = paddedEnd;
    chunkIndex += 1;
  }
  if (!sawPrimary || position !== bytes.length) {
    fail("media_verification.truncated", "WebP static frame is incomplete.");
  }
  const width = extendedWidth ?? primaryWidth;
  const height = extendedHeight ?? primaryHeight;
  if (
    width === undefined ||
    height === undefined ||
    width === 0 ||
    height === 0 ||
    (extendedWidth !== undefined &&
      (extendedWidth !== primaryWidth || extendedHeight !== primaryHeight))
  ) {
    fail(
      "media_verification.malformed",
      "WebP canvas and frame dimensions do not match.",
    );
  }
  return Object.freeze({
    mediaType: "image/webp",
    width,
    height,
    estimatedDecodedBytes: checkedDecodedBytes(width * height, 4),
  });
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(bytes: Buffer): StructuralImageFacts {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail("media_verification.unsupported_media", "Media is not a JPEG object.");
  }
  let position = 2;
  let width: number | undefined;
  let height: number | undefined;
  let components: number | undefined;
  let sawScan = false;
  let sawEnd = false;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      fail("media_verification.malformed", "JPEG marker prefix is missing.");
    }
    const markerStart = position;
    while (position < bytes.length && bytes[position] === 0xff) {
      position += 1;
    }
    if (position >= bytes.length) {
      fail("media_verification.truncated", "JPEG marker is truncated.");
    }
    const marker = bytes[position] ?? 0;
    position += 1;
    if (marker === 0x00) {
      fail(
        "media_verification.malformed",
        "JPEG stuffed byte appears outside entropy data.",
      );
    }
    if (marker === 0xd9) {
      sawEnd = true;
      if (position !== bytes.length) {
        fail(
          "media_verification.malformed",
          "JPEG contains trailing data after EOI.",
        );
      }
      break;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      fail(
        "media_verification.malformed",
        "JPEG standalone marker is misplaced.",
      );
    }
    if (bytes.length - position < 2) {
      fail("media_verification.truncated", "JPEG segment length is truncated.");
    }
    const segmentLength = bytes.readUInt16BE(position);
    if (segmentLength < 2) {
      fail("media_verification.malformed", "JPEG segment length is invalid.");
    }
    const segmentDataStart = position + 2;
    const segmentEnd = position + segmentLength;
    if (segmentEnd > bytes.length) {
      fail(
        "media_verification.truncated",
        "JPEG segment payload is truncated.",
      );
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (
        width !== undefined ||
        (marker !== 0xc0 && marker !== 0xc2) ||
        segmentLength < 11
      ) {
        fail(
          "media_verification.malformed",
          "JPEG frame encoding is duplicate or unsupported.",
        );
      }
      const precision = bytes[segmentDataStart] ?? 0;
      height = bytes.readUInt16BE(segmentDataStart + 1);
      width = bytes.readUInt16BE(segmentDataStart + 3);
      components = bytes[segmentDataStart + 5];
      if (
        precision !== 8 ||
        width === 0 ||
        height === 0 ||
        components === undefined ||
        components < 1 ||
        components > 4 ||
        segmentLength !== 8 + components * 3
      ) {
        fail("media_verification.malformed", "JPEG frame header is invalid.");
      }
    }
    if (marker !== 0xda) {
      position = segmentEnd;
      continue;
    }
    const scanComponents = bytes[segmentDataStart] ?? 0;
    if (
      width === undefined ||
      scanComponents < 1 ||
      segmentLength !== 6 + scanComponents * 2
    ) {
      fail("media_verification.malformed", "JPEG scan header is invalid.");
    }
    sawScan = true;
    position = segmentEnd;
    let foundMarker = false;
    while (position < bytes.length) {
      if (bytes[position] !== 0xff) {
        position += 1;
        continue;
      }
      const entropyMarkerStart = position;
      while (position < bytes.length && bytes[position] === 0xff) {
        position += 1;
      }
      if (position >= bytes.length) {
        fail(
          "media_verification.truncated",
          "JPEG entropy marker is truncated.",
        );
      }
      const entropyMarker = bytes[position] ?? 0;
      if (
        entropyMarker === 0x00 ||
        (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)
      ) {
        position += 1;
        continue;
      }
      position = entropyMarkerStart;
      foundMarker = true;
      break;
    }
    if (!foundMarker) {
      fail(
        "media_verification.truncated",
        "JPEG entropy stream has no terminal marker.",
      );
    }
    if (position <= markerStart) {
      fail("media_verification.malformed", "JPEG parser made no progress.");
    }
  }
  if (
    !sawEnd ||
    !sawScan ||
    width === undefined ||
    height === undefined ||
    components === undefined
  ) {
    fail("media_verification.truncated", "JPEG structure is incomplete.");
  }
  return Object.freeze({
    mediaType: "image/jpeg",
    width,
    height,
    estimatedDecodedBytes: checkedDecodedBytes(
      width * height,
      Math.max(4, components),
    ),
  });
}

function detectAndParse(bytes: Buffer): StructuralImageFacts {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.toString("ascii", 1, 4) === "PNG"
  ) {
    return parsePng(bytes);
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return parseWebp(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return parseJpeg(bytes);
  }
  return fail(
    "media_verification.unsupported_media",
    "Media signature is not an accepted image format.",
  );
}

function enforceStructuralLimits(
  facts: StructuralImageFacts,
  inputBytes: number,
  limits: TrustedImageVerificationLimits,
): void {
  if (
    facts.width > limits.maximumWidth ||
    facts.height > limits.maximumHeight
  ) {
    fail(
      "media_verification.dimensions_exceeded",
      "Image dimensions exceed the verification profile.",
    );
  }
  const pixels = facts.width * facts.height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maximumPixels) {
    fail(
      "media_verification.pixels_exceeded",
      "Image pixel count exceeds the verification profile.",
    );
  }
  if (facts.estimatedDecodedBytes > limits.maximumDecodedBytes) {
    fail(
      "media_verification.decoded_size_exceeded",
      "Estimated decoded image size exceeds the verification profile.",
    );
  }
  if (
    facts.estimatedDecodedBytes / Math.max(1, inputBytes) >
    limits.maximumExpansionRatio
  ) {
    fail(
      "media_verification.expansion_ratio_exceeded",
      "Estimated image expansion ratio exceeds the verification profile.",
    );
  }
}

export async function verifyTrustedImage(
  request: VerifyTrustedImageRequest,
): Promise<TrustedImageVerificationResult> {
  assertLimits(request.limits, request.verificationProfileVersion);
  const bytes = await collectBoundedInput(
    request.body,
    request.limits.maximumInputBytes,
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const structural = detectAndParse(bytes);
  if (
    request.declaredMediaType !== undefined &&
    request.declaredMediaType !== structural.mediaType
  ) {
    return fail(
      "media_verification.declared_type_mismatch",
      "Declared media type does not match the verified signature.",
    );
  }
  enforceStructuralLimits(structural, bytes.length, request.limits);

  let assurance: TrustedImageVerificationResult["assurance"] =
    "structural_only";
  if (request.decodeVerifier) {
    let decoded;
    try {
      decoded = await request.decodeVerifier.verifyDecodedImage({
        mediaType: structural.mediaType,
        bytes,
        structuralWidth: structural.width,
        structuralHeight: structural.height,
        maximumWidth: request.limits.maximumWidth,
        maximumHeight: request.limits.maximumHeight,
        maximumPixels: request.limits.maximumPixels,
        maximumDecodedBytes: request.limits.maximumDecodedBytes,
      });
    } catch (error) {
      return fail(
        "media_verification.decode_failed",
        "Full image decoding failed.",
        error,
      );
    }
    if (
      !Number.isSafeInteger(decoded.width) ||
      !Number.isSafeInteger(decoded.height) ||
      !Number.isSafeInteger(decoded.frameCount) ||
      decoded.width !== structural.width ||
      decoded.height !== structural.height ||
      decoded.frameCount !== 1
    ) {
      return fail(
        decoded.frameCount > 1
          ? "media_verification.animated_not_allowed"
          : "media_verification.decode_mismatch",
        "Decoded image facts do not match the bounded structure.",
      );
    }
    assurance = "decoded";
  } else if (request.limits.requireDecodedVerification) {
    return fail(
      "media_verification.decoder_required",
      "This verification profile requires a full image decoder.",
    );
  }

  const resultHash = createHash("sha256")
    .update("kanvas:image-verification:v1\0")
    .update(
      JSON.stringify({
        verificationProfileVersion: request.verificationProfileVersion,
        byteSize: String(bytes.length),
        sha256,
        detectedMediaType: structural.mediaType,
        width: structural.width,
        height: structural.height,
        frameCount: 1,
        estimatedDecodedBytes: String(structural.estimatedDecodedBytes),
        assurance,
      }),
    )
    .digest("hex");
  return Object.freeze({
    byteSize: String(bytes.length),
    sha256,
    detectedMediaType: structural.mediaType,
    width: structural.width,
    height: structural.height,
    frameCount: 1,
    estimatedDecodedBytes: structural.estimatedDecodedBytes.toString(),
    assurance,
    verificationResultHash: `sha256:${resultHash}`,
  });
}
