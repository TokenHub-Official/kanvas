import {
  assessQuality,
  parseCropSuggestInput,
  parseQualityAssessInput,
  suggestCrops,
} from "@kanvas/image-atomic-core";
import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const imageCropSuggestAdapterKey =
  "first-party.image.crop-suggest.deterministic.v1";
export const imageQualityAssessAdapterKey =
  "first-party.image.quality-assess.deterministic.v1";

const maximumSourceBytes = 64 * 1024 * 1024;
const maximumSourcePixels = 32_000_000;

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
        "Batch C analysis source exceeds the Adapter byte limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

async function normalizedSource(
  context: WorkerAdapterExecutionContext,
  signal: AbortSignal,
) {
  const source = await context.inputArtifacts.open({
    inputPointer: "/sourceArtifactId",
  });
  const bytes = await consumeSource(source.body, signal);
  try {
    const normalized = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: maximumSourcePixels,
    })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (normalized.info.channels !== 4) {
      normalized.data.fill(0);
      throw new Error("Batch C analysis source did not normalize to RGBA.");
    }
    return Object.freeze({
      data: normalized.data,
      width: normalized.info.width,
      height: normalized.info.height,
    });
  } finally {
    bytes.fill(0);
  }
}

export const imageCropSuggestAdapter: WorkerAdapter = Object.freeze({
  adapterKey: imageCropSuggestAdapterKey,
  async execute(
    value: unknown,
    signal: AbortSignal,
    context: WorkerAdapterExecutionContext,
  ) {
    const input = parseCropSuggestInput(value);
    const source = await normalizedSource(context, signal);
    try {
      const suggestions = suggestCrops(source, input);
      signal.throwIfAborted();
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-crop-suggest-result/v1",
          sourceWidth: source.width,
          sourceHeight: source.height,
          suggestions,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-crop-suggest-quality/v1",
            generative: false,
            sourceModified: false,
            saliencyMethod: "alpha_luminance_projection",
            subjectBoundsProvided: input.subjectBounds.length > 0,
          }),
        }),
        outputs: Object.freeze([]),
      });
    } finally {
      source.data.fill(0);
    }
  },
});

export const imageQualityAssessAdapter: WorkerAdapter = Object.freeze({
  adapterKey: imageQualityAssessAdapterKey,
  async execute(
    value: unknown,
    signal: AbortSignal,
    context: WorkerAdapterExecutionContext,
  ) {
    const input = parseQualityAssessInput(value);
    const source = await normalizedSource(context, signal);
    try {
      const assessment = assessQuality(source, input);
      signal.throwIfAborted();
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-quality-assess-result/v1",
          sourceWidth: source.width,
          sourceHeight: source.height,
          ...assessment,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-quality-assess-quality/v1",
            generative: false,
            sourceModified: false,
            method: "deterministic_pixel_diagnostics",
            subjectBoundsProvided: input.subjectBounds.length > 0,
          }),
        }),
        outputs: Object.freeze([]),
      });
    } finally {
      source.data.fill(0);
    }
  },
});
