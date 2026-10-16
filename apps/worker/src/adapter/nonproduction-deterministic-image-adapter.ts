import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

/**
 * This Adapter is a deterministic transport canary, not an image-quality
 * implementation. Deployment config must keep it disabled in production.
 */
export const deterministicImageDerivedPngAdapterKey =
  "test.deterministic.image-derived-png.v1";
const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

interface DeterministicImageInput {
  readonly sourceArtifactId: string;
}

function requireInput(value: unknown): DeterministicImageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Deterministic image Adapter input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(record.sourceArtifactId) ||
    Object.keys(record).some((key) => key !== "sourceArtifactId")
  ) {
    throw new TypeError(
      "Deterministic image Adapter input must contain one source Artifact.",
    );
  }
  return Object.freeze({ sourceArtifactId: record.sourceArtifactId });
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

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function createDeterministicRgbaPng(options: {
  readonly width: number;
  readonly height: number;
  readonly rgba: readonly [number, number, number, number];
}): Buffer {
  if (
    !Number.isSafeInteger(options.width) ||
    options.width < 1 ||
    options.width > 256 ||
    !Number.isSafeInteger(options.height) ||
    options.height < 1 ||
    options.height > 256 ||
    options.rgba.some(
      (channel) => !Number.isInteger(channel) || channel < 0 || channel > 255,
    )
  ) {
    throw new TypeError(
      "Deterministic PNG dimensions or channels are invalid.",
    );
  }
  const rowBytes = options.width * 4 + 1;
  const raw = Buffer.alloc(rowBytes * options.height);
  for (let y = 0; y < options.height; y += 1) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0;
    for (let x = 0; x < options.width; x += 1) {
      const pixelStart = rowStart + 1 + x * 4;
      raw[pixelStart] = options.rgba[0];
      raw[pixelStart + 1] = options.rgba[1];
      raw[pixelStart + 2] = options.rgba[2];
      raw[pixelStart + 3] = options.rgba[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width, 0);
  header.writeUInt32BE(options.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function consumeInputDigest(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  signal.throwIfAborted();
  for await (const chunk of body) {
    signal.throwIfAborted();
    hash.update(chunk);
  }
  signal.throwIfAborted();
  return hash.digest("hex");
}

export const deterministicImageDerivedPngAdapter: WorkerAdapter = Object.freeze(
  {
    adapterKey: deterministicImageDerivedPngAdapterKey,
    async execute(
      input: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const request = requireInput(input);
      const source = await context.inputArtifacts.open({
        inputPointer: "/sourceArtifactId",
      });
      const sourceSha256 = await consumeInputDigest(source.body, signal);
      if (sourceSha256 !== source.sha256) {
        throw new Error(
          "Deterministic image Adapter observed an inconsistent source digest.",
        );
      }
      const digestBytes = Buffer.from(sourceSha256, "hex");
      const output = createDeterministicRgbaPng({
        width: 8,
        height: 8,
        rgba: [
          digestBytes[0] ?? 0,
          digestBytes[1] ?? 0,
          digestBytes[2] ?? 0,
          0,
        ],
      });
      const outputSha256 = createHash("sha256").update(output).digest("hex");
      signal.throwIfAborted();
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.deterministic-image-result/v1" as const,
          imageArtifactId: Object.freeze({
            $kanvas: "attempt-output-artifact/v1" as const,
            outputRole: "primary",
            outputIndex: 0,
          }),
          sourceArtifactId: request.sourceArtifactId,
          capabilityRunId: context.capabilityRunId,
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "primary",
            outputIndex: 0,
            artifactType: "image",
            metadata: Object.freeze({
              nonProduction: true,
              generator: "sha256-swatch/v1",
              width: 8,
              height: 8,
              alpha: "transparent",
            }),
            mediaType: "image/png" as const,
            byteSize: output.byteLength.toString(),
            sha256: outputSha256,
            body: (async function* () {
              await Promise.resolve();
              signal.throwIfAborted();
              yield output;
              signal.throwIfAborted();
            })(),
          }),
        ]),
      });
    },
  },
);
