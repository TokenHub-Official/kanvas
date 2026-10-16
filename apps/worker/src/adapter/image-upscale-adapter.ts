import { createHash } from "node:crypto";

import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const sharpImageResizeAdapterKey = "kanvas.image.resize.sharp.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumSourceBytes = 64 * 1024 * 1024;
const maximumSourcePixels = 16_000_000;
const maximumOutputPixels = 64_000_000;

interface UpscaleInput {
  readonly sourceArtifactId: string;
  readonly scaleFactor: 2;
  readonly resamplingKernel: "lanczos3";
  readonly outputFormat: "png";
}

function requireInput(value: unknown): UpscaleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Image upscale input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const scaleFactor = record.scaleFactor ?? 2;
  const resamplingKernel = record.resamplingKernel ?? "lanczos3";
  const outputFormat = record.outputFormat ?? "png";
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    scaleFactor !== 2 ||
    resamplingKernel !== "lanczos3" ||
    outputFormat !== "png" ||
    Object.keys(record).some(
      (key) =>
        key !== "sourceArtifactId" &&
        key !== "scaleFactor" &&
        key !== "resamplingKernel" &&
        key !== "outputFormat",
    )
  ) {
    throw new TypeError("Sharp image resize input is invalid.");
  }
  return Object.freeze({
    sourceArtifactId,
    scaleFactor: 2,
    resamplingKernel: "lanczos3",
    outputFormat: "png",
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
      throw new RangeError(
        "Image upscale source exceeds the Adapter byte limit.",
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
    outputRole: "upscaled",
    outputIndex: 0,
  });
}

export const sharpImageResizeAdapter: WorkerAdapter = Object.freeze({
  adapterKey: sharpImageResizeAdapterKey,
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
    try {
      signal.throwIfAborted();
      const image = sharp(sourceBytes, {
        failOn: "warning",
        limitInputPixels: maximumSourcePixels,
      }).rotate();
      const metadata = await image.metadata();
      const sourceWidth = metadata.width;
      const sourceHeight = metadata.height;
      if (
        !sourceWidth ||
        !sourceHeight ||
        sourceWidth * sourceHeight > maximumSourcePixels
      ) {
        throw new RangeError(
          "Image upscale source dimensions are unsupported.",
        );
      }
      const outputWidth = sourceWidth * input.scaleFactor;
      const outputHeight = sourceHeight * input.scaleFactor;
      if (
        outputWidth * outputHeight > maximumOutputPixels ||
        outputWidth > 16_384 ||
        outputHeight > 16_384
      ) {
        throw new RangeError(
          "Image upscale output dimensions exceed the faithful 2x limit.",
        );
      }
      const output = await image
        .resize(outputWidth, outputHeight, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
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
          imageArtifact: outputReference(),
          scaleFactor: 2,
          sourceWidth,
          sourceHeight,
          outputWidth,
          outputHeight,
          resamplingKernel: "lanczos3",
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "upscaled",
            outputIndex: 0,
            artifactType: "image.resized",
            metadata: Object.freeze({
              operation: "image.resize",
              sourceArtifactId: input.sourceArtifactId,
              scaleFactor: 2,
              sourceWidth,
              sourceHeight,
              outputWidth,
              outputHeight,
              resamplingKernel: "lanczos3",
            }),
            mediaType: "image/png" as const,
            byteSize: String(output.byteLength),
            sha256,
            body: (async function* () {
              await Promise.resolve();
              signal.throwIfAborted();
              yield output;
              signal.throwIfAborted();
            })(),
          }),
        ]),
      });
    } finally {
      sourceBytes.fill(0);
    }
  },
});
