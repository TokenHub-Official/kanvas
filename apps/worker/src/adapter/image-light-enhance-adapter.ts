import { createHash } from "node:crypto";

import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const imageLightEnhanceAdapterKey =
  "first-party.image.light-enhance.deterministic.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumSourceBytes = 64 * 1024 * 1024;
const maximumSourcePixels = 32_000_000;

interface LightEnhanceInput {
  readonly sourceArtifactId: string;
  readonly exposureStops: number;
  readonly shadows: number;
  readonly highlights: number;
  readonly temperature: number;
  readonly tint: number;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined {
  const candidate = value ?? fallback;
  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= minimum &&
    candidate <= maximum
    ? candidate
    : undefined;
}

function requireInput(value: unknown): LightEnhanceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Image light-enhance input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const exposureStops = boundedNumber(record.exposureStops, 0, -2, 2);
  const shadows = boundedNumber(record.shadows, 0, -1, 1);
  const highlights = boundedNumber(record.highlights, 0, -1, 1);
  const temperature = boundedNumber(record.temperature, 0, -1, 1);
  const tint = boundedNumber(record.tint, 0, -1, 1);
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    exposureStops === undefined ||
    shadows === undefined ||
    highlights === undefined ||
    temperature === undefined ||
    tint === undefined ||
    Object.keys(record).some(
      (key) =>
        ![
          "sourceArtifactId",
          "exposureStops",
          "shadows",
          "highlights",
          "temperature",
          "tint",
        ].includes(key),
    )
  ) {
    throw new TypeError(
      "Image light-enhance input does not match kanvas.image-light-enhance-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    exposureStops,
    shadows,
    highlights,
    temperature,
    tint,
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
        "Image light-enhance source exceeds the Adapter byte limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "enhanced",
    outputIndex: 0,
  });
}

export const imageLightEnhanceAdapter: WorkerAdapter = Object.freeze({
  adapterKey: imageLightEnhanceAdapterKey,
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
          "Image light-enhance source dimensions are unsupported.",
        );
      }
      outputPixels = Buffer.allocUnsafe(sourcePixels.length);
      const exposureMultiplier = 2 ** input.exposureStops;
      let clippedLow = 0;
      let clippedHigh = 0;
      let visiblePixels = 0;
      for (let offset = 0; offset < sourcePixels.length; offset += 4) {
        signal.throwIfAborted();
        const alpha = sourcePixels[offset + 3]!;
        if (alpha === 0) {
          sourcePixels.copy(outputPixels, offset, offset, offset + 4);
          continue;
        }
        visiblePixels += 1;
        const red = sourcePixels[offset]! / 255;
        const green = sourcePixels[offset + 1]! / 255;
        const blue = sourcePixels[offset + 2]! / 255;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const shadowDelta =
          input.shadows * (1 - luminance) * (1 - luminance) * 0.35;
        const highlightDelta = input.highlights * luminance * luminance * 0.25;
        const toneDelta = shadowDelta + highlightDelta;
        const temperatureRed = input.temperature * 0.12;
        const temperatureBlue = -input.temperature * 0.12;
        const tintGreen = input.tint * 0.08;
        const tintOther = -input.tint * 0.04;
        const adjusted = [
          red * exposureMultiplier + toneDelta + temperatureRed + tintOther,
          green * exposureMultiplier + toneDelta + tintGreen,
          blue * exposureMultiplier + toneDelta + temperatureBlue + tintOther,
        ];
        if (adjusted.some((channel) => channel <= 0)) {
          clippedLow += 1;
        }
        if (adjusted.some((channel) => channel >= 1)) {
          clippedHigh += 1;
        }
        outputPixels[offset] = clampByte(adjusted[0]! * 255);
        outputPixels[offset + 1] = clampByte(adjusted[1]! * 255);
        outputPixels[offset + 2] = clampByte(adjusted[2]! * 255);
        outputPixels[offset + 3] = alpha;
      }
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
      const clipRatio = (value: number): number =>
        visiblePixels === 0 ? 0 : Number((value / visiblePixels).toFixed(6));
      const parameters = Object.freeze({
        exposureStops: input.exposureStops,
        shadows: input.shadows,
        highlights: input.highlights,
        temperature: input.temperature,
        tint: input.tint,
      });
      const sha256 = createHash("sha256").update(output).digest("hex");
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-light-enhance-result/v1",
          imageArtifactId: outputReference(),
          parameters,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-light-enhance-quality/v1",
            method: "deterministic_tone_curve",
            generative: false,
            alphaPreserved: true,
            clippedLowRatio: clipRatio(clippedLow),
            clippedHighRatio: clipRatio(clippedHigh),
          }),
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "enhanced",
            outputIndex: 0,
            artifactType: "image.light-enhanced",
            metadata: Object.freeze({
              operation: "image.light.enhance",
              sourceArtifactId: input.sourceArtifactId,
              parameters,
              method: "deterministic_tone_curve",
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
      outputPixels?.fill(0);
    }
  },
});
