import { createHash } from "node:crypto";

import {
  composeBackground,
  parseBackgroundComposeInput,
  type RgbaImage,
} from "@kanvas/image-atomic-core";
import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const imageBackgroundComposeAdapterKey =
  "first-party.image.background-compose.deterministic.v1";

const maximumArtifactBytes = 64 * 1024 * 1024;
const maximumSourcePixels = 32_000_000;

async function consume(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    signal.throwIfAborted();
    byteLength += chunk.byteLength;
    if (byteLength > maximumArtifactBytes) {
      for (const buffered of chunks) {
        buffered.fill(0);
      }
      throw new RangeError(
        "Background compose input exceeds the Adapter byte limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

async function decode(bytes: Buffer): Promise<RgbaImage> {
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
    throw new Error("Background compose input did not normalize to RGBA.");
  }
  return Object.freeze({
    data: normalized.data,
    width: normalized.info.width,
    height: normalized.info.height,
  });
}

async function openImage(
  context: WorkerAdapterExecutionContext,
  inputPointer: string,
  signal: AbortSignal,
): Promise<{
  readonly bytes: Buffer;
  readonly image: RgbaImage;
}> {
  const artifact = await context.inputArtifacts.open({
    inputPointer,
  });
  const bytes = await consume(artifact.body, signal);
  try {
    return Object.freeze({
      bytes,
      image: await decode(bytes),
    });
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function outputReference(outputRole: "composed" | "composition_mask") {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex: 0,
  });
}

function outputBody(bytes: Buffer, signal: AbortSignal) {
  return (async function* () {
    try {
      await Promise.resolve();
      signal.throwIfAborted();
      yield bytes;
    } finally {
      bytes.fill(0);
    }
  })();
}

export const imageBackgroundComposeAdapter: WorkerAdapter = Object.freeze({
  adapterKey: imageBackgroundComposeAdapterKey,
  async execute(
    value: unknown,
    signal: AbortSignal,
    context: WorkerAdapterExecutionContext,
  ) {
    const input = parseBackgroundComposeInput(value);
    const foreground = await openImage(
      context,
      "/foregroundArtifactId",
      signal,
    );
    const mask = input.maskArtifactId
      ? await openImage(context, "/maskArtifactId", signal)
      : undefined;
    const background =
      input.background.kind === "artifact"
        ? await openImage(context, "/background/artifactId", signal)
        : undefined;
    let composed: Uint8ClampedArray | undefined;
    let compositionMask: Uint8ClampedArray | undefined;
    try {
      const result = composeBackground({
        input,
        foreground: foreground.image,
        ...(mask ? { mask: mask.image } : {}),
        ...(background
          ? {
              background: background.image,
            }
          : {}),
      });
      composed = result.image.data;
      compositionMask = result.mask.data;
      const [imagePng, maskPng] = await Promise.all([
        sharp(composed, {
          raw: {
            width: result.image.width,
            height: result.image.height,
            channels: 4,
          },
        })
          .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
          })
          .toBuffer(),
        sharp(compositionMask, {
          raw: {
            width: result.mask.width,
            height: result.mask.height,
            channels: 4,
          },
        })
          .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
          })
          .toBuffer(),
      ]);
      signal.throwIfAborted();
      const inputArtifactIds = Object.freeze([
        input.foregroundArtifactId,
        ...(input.maskArtifactId ? [input.maskArtifactId] : []),
        ...(input.background.kind === "artifact"
          ? [input.background.artifactId]
          : []),
      ]);
      const lineage = Object.freeze({
        operation: "image.background.compose",
        inputArtifactIds,
        canvas: input.canvas,
        requestedPlacement: input.placement,
        resolvedPlacement: result.resolvedPlacement,
        background: input.background,
        generative: false,
        deterministic: true,
        colorSpace: "srgb",
      });
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-background-compose-result/v1",
          imageArtifactId: outputReference("composed"),
          compositionMaskArtifactId: outputReference("composition_mask"),
          canvas: input.canvas,
          resolvedPlacement: result.resolvedPlacement,
          inputArtifactIds,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-background-compose-quality/v1",
            generative: false,
            deterministic: true,
            alphaComposited: true,
            colorSpace: "srgb",
          }),
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "composed",
            outputIndex: 0,
            artifactType: "image.background-composed",
            metadata: lineage,
            mediaType: "image/png" as const,
            byteSize: String(imagePng.byteLength),
            sha256: createHash("sha256").update(imagePng).digest("hex"),
            body: outputBody(imagePng, signal),
          }),
          Object.freeze({
            outputRole: "composition_mask",
            outputIndex: 0,
            artifactType: "image.composition-mask",
            metadata: Object.freeze({
              ...lineage,
              maskConvention: "white_foreground_black_background",
            }),
            mediaType: "image/png" as const,
            byteSize: String(maskPng.byteLength),
            sha256: createHash("sha256").update(maskPng).digest("hex"),
            body: outputBody(maskPng, signal),
          }),
        ]),
      });
    } finally {
      foreground.bytes.fill(0);
      foreground.image.data.fill(0);
      mask?.bytes.fill(0);
      mask?.image.data.fill(0);
      background?.bytes.fill(0);
      background?.image.data.fill(0);
      composed?.fill(0);
      compositionMask?.fill(0);
    }
  },
});
