import { createHash } from "node:crypto";

import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const faithfulImageDenoiseAdapterKey =
  "first-party.image.denoise.median-blend.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumSourceBytes = 64 * 1024 * 1024;
const maximumSourcePixels = 32_000_000;

interface DenoiseInput {
  readonly sourceArtifactId: string;
  readonly strength: number;
}

function requireInput(value: unknown): DenoiseInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Image denoise input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const strength = record.strength ?? 0.5;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    typeof strength !== "number" ||
    !Number.isFinite(strength) ||
    strength < 0.1 ||
    strength > 1 ||
    Object.keys(record).some(
      (key) => key !== "sourceArtifactId" && key !== "strength",
    )
  ) {
    throw new TypeError(
      "Image denoise input does not match kanvas.image-denoise-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    strength,
  });
}

async function consumeSource(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    signal.throwIfAborted();
    byteLength += chunk.byteLength;
    if (byteLength > maximumSourceBytes) {
      for (const buffered of chunks) {
        buffered.fill(0);
      }
      throw new RangeError(
        "Image denoise source exceeds the Adapter byte limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "denoised",
    outputIndex: 0,
  });
}

export const faithfulImageDenoiseAdapter: WorkerAdapter = Object.freeze({
  adapterKey: faithfulImageDenoiseAdapterKey,
  async execute(
    value: unknown,
    signal: AbortSignal,
    context: WorkerAdapterExecutionContext,
  ) {
    const input = requireInput(value);
    const source = await context.inputArtifacts.open({
      inputPointer: "/sourceArtifactId",
    });
    const sourceBytes = await consumeSource(source.body, signal);
    let sourcePixels: Buffer | undefined;
    let filteredPixels: Buffer | undefined;
    let outputPixels: Buffer | undefined;
    try {
      const normalized = await sharp(sourceBytes, {
        failOn: "warning",
        limitInputPixels: maximumSourcePixels,
      })
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      sourcePixels = normalized.data;
      const { width, height, channels } = normalized.info;
      if (channels !== 4 || width * height > maximumSourcePixels) {
        throw new RangeError(
          "Image denoise source dimensions are unsupported.",
        );
      }
      filteredPixels = await sharp(sourcePixels, {
        raw: {
          width,
          height,
          channels: 4,
        },
      })
        .removeAlpha()
        .median(3)
        .raw()
        .toBuffer();
      outputPixels = Buffer.allocUnsafe(sourcePixels.byteLength);
      let absoluteDifference = 0;
      let visibleSamples = 0;
      for (
        let sourceOffset = 0, filteredOffset = 0;
        sourceOffset < sourcePixels.length;
        sourceOffset += 4, filteredOffset += 3
      ) {
        signal.throwIfAborted();
        const alpha = sourcePixels[sourceOffset + 3]!;
        for (let channel = 0; channel < 3; channel += 1) {
          const original = sourcePixels[sourceOffset + channel]!;
          const filtered = filteredPixels[filteredOffset + channel]!;
          outputPixels[sourceOffset + channel] = Math.round(
            original + (filtered - original) * input.strength,
          );
          if (alpha > 0) {
            absoluteDifference += Math.abs(filtered - original);
            visibleSamples += 1;
          }
        }
        outputPixels[sourceOffset + 3] = alpha;
      }
      const noiseEstimate =
        visibleSamples === 0
          ? 0
          : Number((absoluteDifference / visibleSamples / 255).toFixed(6));
      const output = await sharp(outputPixels, {
        raw: {
          width,
          height,
          channels: 4,
        },
      })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
        })
        .toBuffer();
      signal.throwIfAborted();
      const sha256 = createHash("sha256").update(output).digest("hex");
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-denoise-result/v1",
          imageArtifactId: outputReference(),
          noiseEstimate,
          method: "median_blend",
          strength: input.strength,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-denoise-quality/v1",
            qualityIntent: "faithful",
            generative: false,
            alphaPreserved: true,
            kernelSize: 3,
          }),
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "denoised",
            outputIndex: 0,
            artifactType: "image.denoised",
            metadata: Object.freeze({
              operation: "image.denoise",
              sourceArtifactId: input.sourceArtifactId,
              method: "median_blend",
              strength: input.strength,
              noiseEstimate,
              qualityIntent: "faithful",
              generative: false,
              alphaPreserved: true,
            }),
            mediaType: "image/png" as const,
            byteSize: String(output.byteLength),
            sha256,
            body: (async function* () {
              try {
                await Promise.resolve();
                signal.throwIfAborted();
                yield output;
              } finally {
                output.fill(0);
              }
            })(),
          }),
        ]),
      });
    } finally {
      sourceBytes.fill(0);
      sourcePixels?.fill(0);
      filteredPixels?.fill(0);
      outputPixels?.fill(0);
    }
  },
});
