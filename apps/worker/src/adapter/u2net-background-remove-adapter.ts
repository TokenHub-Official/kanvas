import { createHash } from "node:crypto";

import { InferenceSession, Tensor, type OnnxValue } from "onnxruntime-node";
import sharp from "sharp";

import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const u2netBackgroundRemoveAdapterKey =
  "first-party.image.background-remove.isnet.v1";
export const u2netBackgroundRemoveWebpAdapterKey =
  "first-party.image.background-remove.isnet.webp-lossless.v2";

type U2NetForegroundEncoding = "png" | "webp_lossless";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const maximumSourcePixels = 40_000_000;
const maximumSourceBytes = 64 * 1024 * 1024;

export interface U2NetModelBundle {
  readonly inputSize: 320 | 1024;
  readonly license: "Apache-2.0" | "MIT";
  readonly normalization: "imagenet" | "isnet";
  readonly sha256: string;
  readonly variant: "u2net" | "u2netp" | "isnet-general";
}

export interface U2NetInference {
  readonly infer: (
    input: Float32Array,
    signal: AbortSignal,
  ) => Promise<
    | Float32Array
    | {
        readonly mask: Float32Array;
        readonly runtimeColdStart: boolean;
        readonly modelInitializationMilliseconds: number;
        readonly inferenceMilliseconds: number;
      }
  >;
}

interface BackgroundRemoveInput {
  readonly sourceArtifactId: string;
  readonly refinement: "standard" | "fine";
  readonly subjectHint?: string;
}

export interface DecodedSource {
  readonly height: number;
  readonly rgba: Buffer;
  readonly width: number;
}

function requireInput(value: unknown): BackgroundRemoveInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Background removal input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const refinement = record.refinement ?? "standard";
  const subjectHint = record.subjectHint;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    (refinement !== "standard" && refinement !== "fine") ||
    (subjectHint !== undefined &&
      (typeof subjectHint !== "string" ||
        subjectHint.trim().length === 0 ||
        subjectHint.length > 240)) ||
    Object.keys(record).some(
      (key) =>
        key !== "sourceArtifactId" &&
        key !== "refinement" &&
        key !== "subjectHint",
    )
  ) {
    throw new TypeError(
      "Background removal input does not match kanvas.image-background-remove-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    refinement,
    ...(typeof subjectHint === "string"
      ? { subjectHint: subjectHint.trim() }
      : {}),
  });
}

export async function consumeBoundedImageBody(
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
        "Background removal source exceeds the Adapter byte limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

export async function decodeImageSource(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<DecodedSource> {
  signal.throwIfAborted();
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: maximumSourcePixels,
  }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height || width * height > maximumSourcePixels) {
    throw new RangeError(
      "Background removal source dimensions are unsupported.",
    );
  }
  const rgba = await image.ensureAlpha().raw().toBuffer();
  signal.throwIfAborted();
  if (rgba.byteLength !== width * height * 4) {
    throw new Error(
      "Background removal source decoded to an inconsistent pixel buffer.",
    );
  }
  return Object.freeze({ width, height, rgba });
}

export async function prepareU2NetModelInput(
  sourceBytes: Buffer,
  model: Pick<U2NetModelBundle, "inputSize" | "normalization">,
  signal: AbortSignal,
): Promise<Float32Array> {
  signal.throwIfAborted();
  const { data, info } = await sharp(sourceBytes, {
    failOn: "warning",
    limitInputPixels: maximumSourcePixels,
  })
    .rotate()
    .removeAlpha()
    .resize(model.inputSize, model.inputSize, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  signal.throwIfAborted();
  if (
    info.width !== model.inputSize ||
    info.height !== model.inputSize ||
    info.channels !== 3
  ) {
    throw new Error("Background removal model input preparation failed.");
  }
  const input = new Float32Array(3 * model.inputSize * model.inputSize);
  const means = [0.485, 0.456, 0.406] as const;
  const deviations = [0.229, 0.224, 0.225] as const;
  const plane = model.inputSize * model.inputSize;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (const channel of [0, 1, 2] as const) {
      input[channel * plane + pixel] =
        model.normalization === "isnet"
          ? (Number(data[pixel * 3 + channel]) - 128) / 256
          : (Number(data[pixel * 3 + channel]) / 255 - means[channel]) /
            deviations[channel];
    }
  }
  return input;
}

export function normalizeU2NetMask(
  raw: Float32Array,
  inputSize: number,
): Uint8Array {
  const expected = inputSize * inputSize;
  if (raw.length < expected) {
    throw new Error("Background removal model returned an undersized mask.");
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < expected; index += 1) {
    const value = Number(raw[index]);
    if (!Number.isFinite(value)) {
      throw new Error("Background removal model returned a non-finite mask.");
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  if (range <= Number.EPSILON) {
    throw new Error("Background removal model returned a degenerate mask.");
  }
  const mask = new Uint8Array(expected);
  for (let index = 0; index < expected; index += 1) {
    mask[index] = Math.round(((Number(raw[index]) - minimum) / range) * 255);
  }
  return mask;
}

async function renderOutputs(options: {
  readonly foregroundEncoding: U2NetForegroundEncoding;
  readonly mask: Uint8Array;
  readonly refinement: BackgroundRemoveInput["refinement"];
  readonly inputSize: number;
  readonly source: DecodedSource;
  readonly signal: AbortSignal;
}): Promise<{
  readonly foreground: Buffer;
  readonly mask: Buffer;
  readonly foregroundRatio: number;
  readonly uncertainEdgeRatio: number;
}> {
  options.signal.throwIfAborted();
  const maskResult = await renderU2NetMask({
    mask: options.mask,
    refinement: options.refinement,
    inputSize: options.inputSize,
    width: options.source.width,
    height: options.source.height,
    signal: options.signal,
  });
  const resizedMask = maskResult.pixels;
  const composited = Buffer.from(options.source.rgba);
  for (
    let pixel = 0;
    pixel < options.source.width * options.source.height;
    pixel += 1
  ) {
    const alpha = Number(resizedMask[pixel]);
    const existingAlpha = Number(composited[pixel * 4 + 3]);
    composited[pixel * 4 + 3] = Math.round((alpha * existingAlpha) / 255);
  }
  const foregroundPipeline = sharp(composited, {
    raw: {
      width: options.source.width,
      height: options.source.height,
      channels: 4,
    },
  });
  const foreground = await (
    options.foregroundEncoding === "webp_lossless"
      ? foregroundPipeline.webp({ lossless: true, effort: 3 })
      : foregroundPipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  ).toBuffer();
  options.signal.throwIfAborted();
  return Object.freeze({
    foreground,
    mask: maskResult.png,
    foregroundRatio: maskResult.foregroundRatio,
    uncertainEdgeRatio: maskResult.uncertainEdgeRatio,
  });
}

export interface RenderedU2NetMask {
  readonly pixels: Buffer;
  readonly png: Buffer;
  readonly foregroundRatio: number;
  readonly uncertainEdgeRatio: number;
}

export async function renderU2NetMask(options: {
  readonly mask: Uint8Array;
  readonly refinement: "standard" | "fine";
  readonly inputSize: number;
  readonly width: number;
  readonly height: number;
  readonly signal: AbortSignal;
}): Promise<RenderedU2NetMask> {
  options.signal.throwIfAborted();
  let pipeline = sharp(options.mask, {
    raw: {
      width: options.inputSize,
      height: options.inputSize,
      channels: 1,
    },
  }).resize(options.width, options.height, {
    fit: "fill",
    kernel: options.refinement === "fine" ? "lanczos3" : "cubic",
  });
  if (options.refinement === "fine") {
    pipeline = pipeline.blur(0.45);
  }
  const resized = await pipeline
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = resized.data;
  const pixelCount = options.width * options.height;
  if (resized.info.channels !== 1 || pixels.length !== pixelCount) {
    throw new Error(
      "Background removal resized mask must contain exactly one channel.",
    );
  }
  options.signal.throwIfAborted();
  let foregroundPixels = 0;
  let uncertainPixels = 0;
  for (const alpha of pixels) {
    if (alpha >= 128) {
      foregroundPixels += 1;
    }
    if (alpha >= 32 && alpha <= 223) {
      uncertainPixels += 1;
    }
  }
  const png = await sharp(pixels, {
    raw: {
      width: options.width,
      height: options.height,
      channels: 1,
    },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  options.signal.throwIfAborted();
  return Object.freeze({
    pixels,
    png,
    foregroundRatio: foregroundPixels / pixelCount,
    uncertainEdgeRatio: uncertainPixels / pixelCount,
  });
}

export function imageOutputBody(
  bytes: Buffer,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  return (async function* () {
    await Promise.resolve();
    signal.throwIfAborted();
    yield bytes;
    signal.throwIfAborted();
  })();
}

function outputReference(outputRole: string, outputIndex: number) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex,
  });
}

export function imageSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function onnxFloatData(value: OnnxValue | undefined): Float32Array {
  if (
    !value ||
    !(value instanceof Tensor) ||
    value.type !== "float32" ||
    !(value.data instanceof Float32Array)
  ) {
    throw new Error(
      "Background removal model output must be a float32 Tensor.",
    );
  }
  return value.data;
}

export function createU2NetOnnxInference(
  bundle: U2NetModelBundle,
  loadModel: (signal: AbortSignal) => Promise<Uint8Array>,
): U2NetInference {
  if (
    !["Apache-2.0", "MIT"].includes(bundle.license) ||
    ![320, 1024].includes(bundle.inputSize) ||
    !["imagenet", "isnet"].includes(bundle.normalization) ||
    !sha256Pattern.test(bundle.sha256)
  ) {
    throw new TypeError("U2-Net model bundle metadata is invalid.");
  }
  let sessionPromise: Promise<InferenceSession> | undefined;
  let sessionReady = false;
  const session = async (signal: AbortSignal): Promise<InferenceSession> => {
    sessionPromise ??= (async () => {
      const bytes = await loadModel(signal);
      signal.throwIfAborted();
      if (imageSha256(bytes) !== bundle.sha256) {
        throw new Error(
          "U2-Net model resource digest does not match its published revision.",
        );
      }
      return await InferenceSession.create(bytes, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
    })().catch((error: unknown) => {
      sessionPromise = undefined;
      throw error;
    });
    return sessionPromise;
  };
  return Object.freeze({
    async infer(
      input: Float32Array,
      signal: AbortSignal,
    ): ReturnType<U2NetInference["infer"]> {
      signal.throwIfAborted();
      const runtimeColdStart = !sessionReady;
      const initializationStartedAt = performance.now();
      const activeSession = await session(signal);
      const modelInitializationMilliseconds = runtimeColdStart
        ? Math.max(0, performance.now() - initializationStartedAt)
        : 0;
      sessionReady = true;
      signal.throwIfAborted();
      const inputName = activeSession.inputNames[0];
      const outputName = activeSession.outputNames[0];
      if (!inputName || !outputName) {
        throw new Error("U2-Net model bundle has no usable input or output.");
      }
      const inferenceStartedAt = performance.now();
      const result = await activeSession.run({
        [inputName]: new Tensor("float32", input, [
          1,
          3,
          bundle.inputSize,
          bundle.inputSize,
        ]),
      });
      const inferenceMilliseconds = Math.max(
        0,
        performance.now() - inferenceStartedAt,
      );
      signal.throwIfAborted();
      return Object.freeze({
        mask: onnxFloatData(result[outputName]),
        runtimeColdStart,
        modelInitializationMilliseconds,
        inferenceMilliseconds,
      });
    },
  });
}

export interface ResolvedU2NetModelResourceRuntime {
  readonly inference: U2NetInference;
  readonly model: U2NetModelBundle;
}

export interface U2NetModelResourceRuntimeResolver {
  readonly resolve: (
    context: WorkerAdapterExecutionContext,
    signal: AbortSignal,
  ) => Promise<ResolvedU2NetModelResourceRuntime>;
}

function configurationRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function modelBundleFrom(
  context: WorkerAdapterExecutionContext,
): U2NetModelBundle {
  const resource = context.modelResource;
  if (!resource) {
    throw new Error(
      "This Runtime Adapter requires a published model resource.",
    );
  }
  const configuration = configurationRecord(
    context.implementationConfiguration,
    "U2-Net implementation configuration",
  );
  const configured = configurationRecord(
    configuration.model,
    "U2-Net model configuration",
  );
  const manifest = resource.manifest;
  const sha256 =
    typeof configured.sha256 === "string"
      ? configured.sha256.replace(/^sha256:/u, "")
      : "";
  const inputSize = configured.inputSize;
  const normalization = configured.normalization;
  const variant = configured.variant;
  const license = configured.license;
  if (
    manifest.format !== "onnx" ||
    !manifest.executionTargets.includes("worker") ||
    configured.family !== manifest.family ||
    variant !== manifest.variant ||
    sha256 !== manifest.sha256.slice("sha256:".length) ||
    license !== manifest.license.spdxId ||
    (inputSize !== 320 && inputSize !== 1024) ||
    (normalization !== "imagenet" && normalization !== "isnet") ||
    (variant !== "u2net" &&
      variant !== "u2netp" &&
      variant !== "isnet-general") ||
    (license !== "Apache-2.0" && license !== "MIT")
  ) {
    throw new Error(
      "Published model resource is incompatible with this Runtime Adapter revision.",
    );
  }
  return Object.freeze({
    inputSize,
    license,
    normalization,
    sha256,
    variant,
  });
}

export function createU2NetModelResourceRuntimeResolver(
  maximumCachedModels = 4,
): U2NetModelResourceRuntimeResolver {
  if (
    !Number.isSafeInteger(maximumCachedModels) ||
    maximumCachedModels < 1 ||
    maximumCachedModels > 16
  ) {
    throw new RangeError("U2-Net model cache size must be between 1 and 16.");
  }
  const cache = new Map<string, ResolvedU2NetModelResourceRuntime>();
  return Object.freeze({
    resolve(context: WorkerAdapterExecutionContext, signal: AbortSignal) {
      signal.throwIfAborted();
      const resource = context.modelResource;
      if (!resource) {
        throw new Error(
          "This Runtime Adapter requires a published model resource.",
        );
      }
      const cacheKey = `${resource.revisionId}:${resource.revisionDigest}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return Promise.resolve(cached);
      }
      const model = modelBundleFrom(context);
      const resolved = Object.freeze({
        model,
        inference: createU2NetOnnxInference(model, (readSignal) =>
          resource.read(readSignal),
        ),
      });
      cache.set(cacheKey, resolved);
      while (cache.size > maximumCachedModels) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        cache.delete(oldest);
      }
      return Promise.resolve(resolved);
    },
  });
}

export function createU2NetBackgroundRemoveAdapter(options: {
  readonly adapterKey?:
    | typeof u2netBackgroundRemoveAdapterKey
    | typeof u2netBackgroundRemoveWebpAdapterKey;
  readonly foregroundEncoding?: U2NetForegroundEncoding;
  readonly inference: U2NetInference;
  readonly model: Pick<
    U2NetModelBundle,
    "inputSize" | "normalization" | "sha256" | "variant"
  >;
}): WorkerAdapter {
  return Object.freeze({
    adapterKey: options.adapterKey ?? u2netBackgroundRemoveAdapterKey,
    async execute(
      value: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const input = requireInput(value);
      const sourceDownloadStartedAt = performance.now();
      const sourceArtifact = await context.inputArtifacts.open({
        inputPointer: "/sourceArtifactId",
      });
      const sourceBytes = await consumeBoundedImageBody(
        sourceArtifact.body,
        signal,
      );
      const sourceDownloadMilliseconds = Math.max(
        0,
        performance.now() - sourceDownloadStartedAt,
      );
      if (imageSha256(sourceBytes) !== sourceArtifact.sha256) {
        throw new Error("Background removal source digest is inconsistent.");
      }
      const preparationStartedAt = performance.now();
      const [source, preparedInput] = await Promise.all([
        decodeImageSource(sourceBytes, signal),
        prepareU2NetModelInput(sourceBytes, options.model, signal),
      ]);
      const inputPreparationMilliseconds = Math.max(
        0,
        performance.now() - preparationStartedAt,
      );
      const inference = await options.inference.infer(preparedInput, signal);
      const inferenceResult =
        inference instanceof Float32Array
          ? {
              mask: inference,
              runtimeColdStart: false,
              modelInitializationMilliseconds: 0,
              inferenceMilliseconds: 0,
            }
          : inference;
      const renderStartedAt = performance.now();
      const rendered = await renderOutputs({
        foregroundEncoding: options.foregroundEncoding ?? "png",
        source,
        mask: normalizeU2NetMask(inferenceResult.mask, options.model.inputSize),
        inputSize: options.model.inputSize,
        refinement: input.refinement,
        signal,
      });
      const outputRenderingMilliseconds = Math.max(
        0,
        performance.now() - renderStartedAt,
      );
      const executionTimings = Object.freeze({
        runtimeColdStart: inferenceResult.runtimeColdStart,
        modelInitializationMilliseconds: Number(
          inferenceResult.modelInitializationMilliseconds.toFixed(3),
        ),
        sourceDownloadMilliseconds: Number(
          sourceDownloadMilliseconds.toFixed(3),
        ),
        inputPreparationMilliseconds: Number(
          inputPreparationMilliseconds.toFixed(3),
        ),
        inferenceMilliseconds: Number(
          inferenceResult.inferenceMilliseconds.toFixed(3),
        ),
        outputRenderingMilliseconds: Number(
          outputRenderingMilliseconds.toFixed(3),
        ),
      });
      const foregroundSha256 = imageSha256(rendered.foreground);
      const maskSha256 = imageSha256(rendered.mask);
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-background-remove-result/v1" as const,
          foregroundArtifactId: outputReference("foreground", 0),
          maskArtifactId: outputReference("mask", 0),
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-background-remove-quality/v1" as const,
            foregroundRatio: rendered.foregroundRatio,
            uncertainEdgeRatio: rendered.uncertainEdgeRatio,
            modelVariant: options.model.variant,
            modelDigest: `sha256:${options.model.sha256}`,
            refinement: input.refinement,
          }),
        }),
        outputs: Object.freeze([
          Object.freeze({
            outputRole: "foreground",
            outputIndex: 0,
            artifactType: "image",
            metadata: Object.freeze({
              operation: "image.background.remove",
              role: "foreground",
              width: source.width,
              height: source.height,
              sourceArtifactId: input.sourceArtifactId,
              sourceSha256: sourceArtifact.sha256,
              modelVariant: options.model.variant,
              modelSha256: options.model.sha256,
              refinement: input.refinement,
              foregroundEncoding: options.foregroundEncoding ?? "png",
              executionTimings,
            }),
            mediaType:
              options.foregroundEncoding === "webp_lossless"
                ? ("image/webp" as const)
                : ("image/png" as const),
            byteSize: rendered.foreground.byteLength.toString(),
            sha256: foregroundSha256,
            body: imageOutputBody(rendered.foreground, signal),
          }),
          Object.freeze({
            outputRole: "mask",
            outputIndex: 0,
            artifactType: "image",
            metadata: Object.freeze({
              operation: "image.background.remove",
              role: "mask",
              width: source.width,
              height: source.height,
              sourceArtifactId: input.sourceArtifactId,
              sourceSha256: sourceArtifact.sha256,
              modelVariant: options.model.variant,
              modelSha256: options.model.sha256,
              refinement: input.refinement,
              executionTimings,
            }),
            mediaType: "image/png" as const,
            byteSize: rendered.mask.byteLength.toString(),
            sha256: maskSha256,
            body: imageOutputBody(rendered.mask, signal),
          }),
        ]),
      });
    },
  });
}
