import { env, InferenceSession, Tensor, type OnnxValue } from "onnxruntime-web";

import type { BrowserU2NetConfiguration } from "./u2net-browser-types.js";

export const browserU2NetBackgroundRemoveAdapterKey =
  "first-party.image.background-remove.isnet.browser.v1";
export const browserU2NetSubjectDetectAdapterKey =
  "first-party.image.subject-detect.isnet.browser.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:([0-9a-f]{64})$/u;
const maximumPixels = 40_000_000;

export interface BrowserBackgroundRemoveResult {
  readonly analysisMask: Uint8Array;
  readonly analysisSize: number;
  readonly foreground: Blob;
  readonly foregroundRatio: number;
  readonly height: number;
  readonly mask: Blob;
  readonly uncertainEdgeRatio: number;
  readonly width: number;
  readonly runtimeColdStart: boolean;
  readonly modelInitializationMilliseconds: number;
}

type BrowserBackgroundRemoveCoreResult = Omit<
  BrowserBackgroundRemoveResult,
  "modelInitializationMilliseconds" | "runtimeColdStart"
>;

export interface BackgroundRemoveInput {
  readonly refinement: "standard" | "fine";
  readonly sourceArtifactId: string;
  readonly subjectHint?: string;
}

export interface BrowserSubjectDetectInput {
  readonly sourceArtifactId: string;
  readonly maxSubjects: number;
  readonly minimumAreaRatio: number;
  readonly minimumConfidence: number;
  readonly includeMask: boolean;
}

export interface BrowserSubjectCandidate {
  readonly subjectId: string;
  readonly rank: number;
  readonly category: "visual_subject";
  readonly confidence: number;
  readonly areaRatio: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly normalizedBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    );
}

export function parseBrowserBackgroundRemoveInput(
  value: unknown,
): BackgroundRemoveInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser background-removal input must be an object.");
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
    throw new TypeError("Browser background-removal input is invalid.");
  }
  return Object.freeze({
    sourceArtifactId,
    refinement,
    ...(typeof subjectHint === "string"
      ? { subjectHint: subjectHint.trim() }
      : {}),
  });
}

export function parseBrowserSubjectDetectInput(
  value: unknown,
): BrowserSubjectDetectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser subject-detection input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const maxSubjects = record.maxSubjects ?? 8;
  const minimumAreaRatio = record.minimumAreaRatio ?? 0.001;
  const minimumConfidence = record.minimumConfidence ?? 0.35;
  const includeMask = record.includeMask ?? true;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    !Number.isSafeInteger(maxSubjects) ||
    Number(maxSubjects) < 1 ||
    Number(maxSubjects) > 16 ||
    typeof minimumAreaRatio !== "number" ||
    !Number.isFinite(minimumAreaRatio) ||
    minimumAreaRatio < 0.000_01 ||
    minimumAreaRatio > 0.5 ||
    typeof minimumConfidence !== "number" ||
    !Number.isFinite(minimumConfidence) ||
    minimumConfidence < 0.05 ||
    minimumConfidence > 0.95 ||
    typeof includeMask !== "boolean" ||
    Object.keys(record).some(
      (key) =>
        key !== "sourceArtifactId" &&
        key !== "maxSubjects" &&
        key !== "minimumAreaRatio" &&
        key !== "minimumConfidence" &&
        key !== "includeMask",
    )
  ) {
    throw new TypeError("Browser subject-detection input is invalid.");
  }
  return Object.freeze({
    sourceArtifactId,
    maxSubjects: Number(maxSubjects),
    minimumAreaRatio,
    minimumConfidence,
    includeMask,
  });
}

interface BrowserSubjectComponent {
  readonly area: number;
  readonly confidence: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly minimumX: number;
  readonly minimumY: number;
}

function browserSubjectComponents(options: {
  readonly mask: Uint8Array;
  readonly size: number;
  readonly minimumAreaRatio: number;
  readonly minimumConfidence: number;
  readonly signal: AbortSignal;
}): readonly BrowserSubjectComponent[] {
  const pixelCount = options.size * options.size;
  if (options.mask.length !== pixelCount) {
    throw new Error(
      "Browser subject-detection mask dimensions are inconsistent.",
    );
  }
  const threshold = Math.round(options.minimumConfidence * 255);
  const minimumArea = Math.max(
    1,
    Math.ceil(options.minimumAreaRatio * pixelCount),
  );
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: BrowserSubjectComponent[] = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] === 1 || Number(options.mask[start]) < threshold) {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;
    let area = 0;
    let confidenceSum = 0;
    let minimumX = options.size;
    let minimumY = options.size;
    let maximumX = 0;
    let maximumY = 0;
    while (head < tail) {
      if ((head & 16_383) === 0) {
        options.signal.throwIfAborted();
      }
      const index = Number(queue[head]);
      head += 1;
      const x = index % options.size;
      const y = Math.floor(index / options.size);
      area += 1;
      confidenceSum += Number(options.mask[index]);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < options.size ? index + 1 : -1,
        y > 0 ? index - options.size : -1,
        y + 1 < options.size ? index + options.size : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          visited[neighbor] === 0 &&
          Number(options.mask[neighbor]) >= threshold
        ) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    if (area >= minimumArea) {
      components.push(
        Object.freeze({
          area,
          confidence: confidenceSum / area / 255,
          minimumX,
          minimumY,
          maximumX,
          maximumY,
        }),
      );
    }
  }
  return Object.freeze(
    components.sort(
      (left, right) =>
        right.area - left.area ||
        right.confidence - left.confidence ||
        left.minimumY - right.minimumY ||
        left.minimumX - right.minimumX,
    ),
  );
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

export function detectBrowserSubjects(
  result: Pick<
    BrowserBackgroundRemoveResult,
    "analysisMask" | "analysisSize" | "width" | "height"
  >,
  input: BrowserSubjectDetectInput,
  signal: AbortSignal,
): readonly BrowserSubjectCandidate[] {
  const components = browserSubjectComponents({
    mask: result.analysisMask,
    size: result.analysisSize,
    minimumAreaRatio: input.minimumAreaRatio,
    minimumConfidence: input.minimumConfidence,
    signal,
  });
  const pixelCount = result.analysisSize * result.analysisSize;
  return Object.freeze(
    components.slice(0, input.maxSubjects).map((component, index) => {
      const x = Math.floor(
        (component.minimumX / result.analysisSize) * result.width,
      );
      const y = Math.floor(
        (component.minimumY / result.analysisSize) * result.height,
      );
      const right = Math.min(
        result.width,
        Math.ceil(
          ((component.maximumX + 1) / result.analysisSize) * result.width,
        ),
      );
      const bottom = Math.min(
        result.height,
        Math.ceil(
          ((component.maximumY + 1) / result.analysisSize) * result.height,
        ),
      );
      const width = Math.max(1, right - x);
      const height = Math.max(1, bottom - y);
      return Object.freeze({
        subjectId: `subject-${String(index + 1)}`,
        rank: index + 1,
        category: "visual_subject" as const,
        confidence: rounded(component.confidence),
        areaRatio: rounded(component.area / pixelCount),
        bounds: Object.freeze({
          x,
          y,
          width,
          height,
        }),
        normalizedBounds: Object.freeze({
          x: rounded(x / result.width),
          y: rounded(y / result.height),
          width: rounded(width / result.width),
          height: rounded(height / result.height),
        }),
      });
    }),
  );
}

type RenderingCanvas = HTMLCanvasElement | OffscreenCanvas;
type RenderingContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function canvas(width: number, height: number): RenderingCanvas {
  if (typeof document === "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  return value;
}

function context2d(value: RenderingCanvas): RenderingContext {
  const context = value.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("Browser background removal requires a 2D Canvas context.");
  }
  return context;
}

function blob(value: RenderingCanvas): Promise<Blob> {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    value instanceof OffscreenCanvas
  ) {
    return value.convertToBlob({
      type: "image/png",
    });
  }
  return new Promise((resolve, reject) => {
    (value as HTMLCanvasElement).toBlob((result: Blob | null) => {
      if (result) {
        resolve(result);
      } else {
        reject(
          new Error("Browser background-removal output could not be encoded."),
        );
      }
    }, "image/png");
  });
}

function modelInput(
  image: ImageBitmap,
  inputSize: number,
  normalization: BrowserU2NetConfiguration["normalization"],
): Float32Array {
  const target = canvas(inputSize, inputSize);
  const context = context2d(target);
  context.drawImage(image, 0, 0, inputSize, inputSize);
  const rgba = context.getImageData(0, 0, inputSize, inputSize).data;
  const input = new Float32Array(3 * inputSize * inputSize);
  const means = [0.485, 0.456, 0.406] as const;
  const deviations = [0.229, 0.224, 0.225] as const;
  const plane = inputSize * inputSize;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (const channel of [0, 1, 2] as const) {
      input[channel * plane + pixel] =
        normalization === "isnet"
          ? (Number(rgba[pixel * 4 + channel]) - 128) / 256
          : (Number(rgba[pixel * 4 + channel]) / 255 - means[channel]) /
            deviations[channel];
    }
  }
  return input;
}

function floatOutput(value: OnnxValue | undefined): Float32Array {
  if (
    !value ||
    !(value instanceof Tensor) ||
    value.type !== "float32" ||
    !(value.data instanceof Float32Array)
  ) {
    throw new Error("Browser U-2-Net output must be a float32 Tensor.");
  }
  return value.data;
}

function normalizedMask(
  raw: Float32Array,
  inputSize: number,
): Uint8ClampedArray {
  const pixelCount = inputSize * inputSize;
  if (raw.length < pixelCount) {
    throw new Error("Browser U-2-Net returned an undersized mask.");
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pixelCount; index += 1) {
    const value = Number(raw[index]);
    if (!Number.isFinite(value)) {
      throw new Error("Browser U-2-Net returned a non-finite mask.");
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  if (range <= Number.EPSILON) {
    throw new Error("Browser U-2-Net returned a degenerate mask.");
  }
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const alpha = Math.round(((Number(raw[index]) - minimum) / range) * 255);
    rgba[index * 4] = alpha;
    rgba[index * 4 + 1] = alpha;
    rgba[index * 4 + 2] = alpha;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

async function render(
  image: ImageBitmap,
  maskRgba: Uint8ClampedArray,
  refinement: BackgroundRemoveInput["refinement"],
  inputSize: number,
  signal: AbortSignal,
): Promise<BrowserBackgroundRemoveCoreResult> {
  const width = image.width;
  const height = image.height;
  if (width < 1 || height < 1 || width * height > maximumPixels) {
    throw new RangeError(
      "Browser background-removal source dimensions are unsupported.",
    );
  }
  const modelMask = canvas(inputSize, inputSize);
  const maskImageData = new ImageData(inputSize, inputSize);
  maskImageData.data.set(maskRgba);
  context2d(modelMask).putImageData(maskImageData, 0, 0);
  const resizedMask = canvas(width, height);
  const resizedMaskContext = context2d(resizedMask);
  resizedMaskContext.imageSmoothingEnabled = true;
  resizedMaskContext.imageSmoothingQuality =
    refinement === "fine" ? "high" : "medium";
  resizedMaskContext.drawImage(modelMask, 0, 0, width, height);
  const maskPixels = resizedMaskContext.getImageData(0, 0, width, height);
  const foreground = canvas(width, height);
  const foregroundContext = context2d(foreground);
  foregroundContext.drawImage(image, 0, 0);
  const sourcePixels = foregroundContext.getImageData(0, 0, width, height);
  let foregroundPixels = 0;
  let uncertainPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = Number(maskPixels.data[pixel * 4]);
    const existingAlpha = Number(sourcePixels.data[pixel * 4 + 3]);
    sourcePixels.data[pixel * 4 + 3] = Math.round(
      (alpha * existingAlpha) / 255,
    );
    if (alpha >= 128) {
      foregroundPixels += 1;
    }
    if (alpha >= 32 && alpha <= 223) {
      uncertainPixels += 1;
    }
  }
  foregroundContext.putImageData(sourcePixels, 0, 0);
  signal.throwIfAborted();
  const [foregroundBlob, maskBlob] = await Promise.all([
    blob(foreground),
    blob(resizedMask),
  ]);
  signal.throwIfAborted();
  const pixelCount = width * height;
  return Object.freeze({
    analysisMask: Uint8Array.from(
      { length: inputSize * inputSize },
      (_, index) => Number(maskRgba[index * 4]),
    ),
    analysisSize: inputSize,
    foreground: foregroundBlob,
    mask: maskBlob,
    width,
    height,
    foregroundRatio: foregroundPixels / pixelCount,
    uncertainEdgeRatio: uncertainPixels / pixelCount,
  });
}

export function createDirectBrowserU2NetBackgroundRemover(
  configuration: BrowserU2NetConfiguration,
) {
  const match = digestPattern.exec(configuration.modelDigest);
  if (
    !match ||
    !configuration.modelUrl ||
    !configuration.wasmPaths ||
    ![320, 1024].includes(configuration.inputSize) ||
    !["imagenet", "isnet"].includes(configuration.normalization) ||
    !["u2net", "u2netp", "isnet-general-fp16"].includes(
      configuration.modelVariant,
    )
  ) {
    throw new TypeError("Browser U-2-Net configuration is invalid.");
  }
  env.wasm.wasmPaths = configuration.wasmPaths;
  let sessionPromise: Promise<InferenceSession> | undefined;
  let sessionReady = false;
  const session = async (): Promise<InferenceSession> => {
    sessionPromise ??= (async () => {
      const response = await fetch(configuration.modelUrl, {
        credentials: "same-origin",
        cache: "force-cache",
        ...(configuration.modelWorkspaceId
          ? {
              headers: {
                "x-kanvas-workspace-id": configuration.modelWorkspaceId,
              },
            }
          : {}),
      });
      if (!response.ok) {
        throw new Error(
          `Browser U-2-Net model request failed with status ${String(response.status)}.`,
        );
      }
      const bytes = await response.arrayBuffer();
      if ((await sha256Hex(bytes)) !== match[1]) {
        throw new Error(
          "Browser U-2-Net model digest does not match the release manifest.",
        );
      }
      return await InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    })().catch((error: unknown) => {
      sessionPromise = undefined;
      throw error;
    });
    return sessionPromise;
  };
  return Object.freeze({
    async execute(
      source: Blob,
      input: BackgroundRemoveInput,
      signal: AbortSignal,
    ): Promise<BrowserBackgroundRemoveResult> {
      signal.throwIfAborted();
      const image = await createImageBitmap(source);
      try {
        const runtimeColdStart = !sessionReady;
        const initializationStartedAt = performance.now();
        const activeSession = await session();
        const modelInitializationMilliseconds = runtimeColdStart
          ? Math.max(0, performance.now() - initializationStartedAt)
          : 0;
        sessionReady = true;
        signal.throwIfAborted();
        const inputName = activeSession.inputNames[0];
        const outputName = activeSession.outputNames[0];
        if (!inputName || !outputName) {
          throw new Error(
            "Browser U-2-Net model has no usable input or output.",
          );
        }
        const outputs = await activeSession.run({
          [inputName]: new Tensor(
            "float32",
            modelInput(
              image,
              configuration.inputSize,
              configuration.normalization,
            ),
            [1, 3, configuration.inputSize, configuration.inputSize],
          ),
        });
        signal.throwIfAborted();
        const rendered = await render(
          image,
          normalizedMask(
            floatOutput(outputs[outputName]),
            configuration.inputSize,
          ),
          input.refinement,
          configuration.inputSize,
          signal,
        );
        return Object.freeze({
          ...rendered,
          runtimeColdStart,
          modelInitializationMilliseconds,
        });
      } finally {
        image.close();
      }
    },
  });
}
