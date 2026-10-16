import { createHash } from "node:crypto";

import { createWorker, OEM, PSM } from "tesseract.js";
import sharp from "sharp";

import {
  WorkerAdapterNotApplicableError,
  type WorkerAdapter,
  type WorkerAdapterExecutionContext,
} from "./worker-adapter.js";

export const tesseractTextExtractAdapterKey =
  "first-party.image.text-extract.tesseract.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const languageTagPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const modelCodePattern = /^[a-z][a-z0-9_]{1,31}$/u;
const hardMaximumSourceBytes = 67_108_864;
const hardMaximumSourcePixels = 32_000_000;
const maximumBlocks = 10_000;

interface TesseractModelConfiguration {
  readonly family: string;
  readonly variant: string;
  readonly languageTag: string;
  readonly modelCode: string;
  readonly sha256: string;
  readonly license: string;
  readonly engineVersion: string;
  readonly maximumSourceBytes: number;
  readonly maximumSourcePixels: number;
}

interface TextExtractInput {
  readonly sourceArtifactId: string;
  readonly language: string;
  readonly granularity: "line" | "word";
  readonly minimumConfidence: number;
}

interface OcrBounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface TesseractWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: OcrBounds;
}

interface TesseractLine {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: OcrBounds;
  readonly words: readonly TesseractWord[];
}

interface TesseractBlock {
  readonly paragraphs: readonly {
    readonly is_ltr: boolean;
    readonly lines: readonly TesseractLine[];
  }[];
}

interface TesseractRecognitionResult {
  readonly text: string;
  readonly confidence: number;
  readonly blocks: readonly TesseractBlock[];
}

export type TesseractRecognizer = (options: {
  readonly image: Uint8Array;
  readonly modelBytes: Uint8Array;
  readonly modelCode: string;
  readonly signal: AbortSignal;
}) => Promise<TesseractRecognitionResult>;

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function positiveInteger(
  value: unknown,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > maximum
  ) {
    throw new TypeError(`${label} is outside the supported range.`);
  }
  return Number(value);
}

export function tesseractModelConfiguration(
  context: WorkerAdapterExecutionContext,
): TesseractModelConfiguration {
  const resource = context.modelResource;
  if (!resource) {
    throw new Error(
      "This Runtime Adapter requires a published model resource.",
    );
  }
  const configuration = record(
    context.implementationConfiguration,
    "Tesseract implementation configuration",
  );
  const model = record(configuration.model, "Tesseract model configuration");
  const family = model.family;
  const variant = model.variant;
  const languageTag = model.languageTag;
  const modelCode = model.modelCode;
  const sha256 = model.sha256;
  const license = model.license;
  const engineVersion = configuration.engineVersion;
  const maximumSourceBytes = positiveInteger(
    configuration.maximumSourceBytes,
    hardMaximumSourceBytes,
    "Tesseract maximum source bytes",
  );
  const maximumSourcePixels = positiveInteger(
    configuration.maximumSourcePixels,
    hardMaximumSourcePixels,
    "Tesseract maximum source pixels",
  );
  const manifest = resource.manifest;
  if (
    typeof family !== "string" ||
    typeof variant !== "string" ||
    typeof languageTag !== "string" ||
    !languageTagPattern.test(languageTag) ||
    typeof modelCode !== "string" ||
    !modelCodePattern.test(modelCode) ||
    typeof sha256 !== "string" ||
    !digestPattern.test(sha256) ||
    typeof license !== "string" ||
    engineVersion !== "7.0.0" ||
    manifest.format !== "tesseract_data" ||
    !manifest.executionTargets.includes("worker") ||
    manifest.family !== family ||
    manifest.variant !== variant ||
    manifest.sha256 !== `sha256:${sha256}` ||
    manifest.license.spdxId !== license
  ) {
    throw new Error(
      "Published model resource is incompatible with this Tesseract Runtime Adapter revision.",
    );
  }
  return Object.freeze({
    family,
    variant,
    languageTag,
    modelCode,
    sha256,
    license,
    engineVersion,
    maximumSourceBytes,
    maximumSourcePixels,
  });
}

function requireInput(
  value: unknown,
  model: TesseractModelConfiguration,
): TextExtractInput {
  const input = record(value, "Image text-extract input");
  const sourceArtifactId = input.sourceArtifactId;
  const languages = input.languages ?? [model.languageTag];
  const granularity = input.granularity ?? "line";
  const minimumConfidence = input.minimumConfidence ?? 0.5;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    !Array.isArray(languages) ||
    languages.length < 1 ||
    languages.length > 8 ||
    languages.some(
      (language) =>
        typeof language !== "string" || !languageTagPattern.test(language),
    ) ||
    new Set(languages).size !== languages.length ||
    (granularity !== "line" && granularity !== "word") ||
    typeof minimumConfidence !== "number" ||
    !Number.isFinite(minimumConfidence) ||
    minimumConfidence < 0 ||
    minimumConfidence > 1 ||
    Object.keys(input).some(
      (key) =>
        ![
          "sourceArtifactId",
          "languages",
          "granularity",
          "minimumConfidence",
        ].includes(key),
    )
  ) {
    throw new TypeError(
      "Image text-extract input does not match its published Adapter interface.",
    );
  }
  if (languages.length !== 1 || languages[0] !== model.languageTag) {
    throw new WorkerAdapterNotApplicableError(
      "model_resource.language_not_supported",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    language: model.languageTag,
    granularity,
    minimumConfidence,
  });
}

async function consumeSource(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  maximumSourceBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    signal.throwIfAborted();
    byteLength += chunk.byteLength;
    if (byteLength > maximumSourceBytes) {
      for (const buffered of chunks) buffered.fill(0);
      throw new RangeError("Image text-extract source exceeds its byte limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, byteLength);
}

function confidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value / 100)).toFixed(6));
}

function polygon(bounds: OcrBounds) {
  return Object.freeze([
    Object.freeze({ x: bounds.x0, y: bounds.y0 }),
    Object.freeze({ x: bounds.x1, y: bounds.y0 }),
    Object.freeze({ x: bounds.x1, y: bounds.y1 }),
    Object.freeze({ x: bounds.x0, y: bounds.y1 }),
  ]);
}

function flattenBlocks(
  blocks: readonly TesseractBlock[],
  granularity: "line" | "word",
) {
  const result: Array<Readonly<Record<string, unknown>>> = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const candidates = granularity === "line" ? [line] : line.words;
        for (const candidate of candidates) {
          const text = candidate.text.trim();
          if (text) {
            result.push(
              Object.freeze({
                level: granularity,
                text,
                confidence: confidence(candidate.confidence),
                polygon: polygon(candidate.bbox),
              }),
            );
          }
          if (result.length > maximumBlocks) {
            throw new RangeError(
              "Image text-extract output exceeds its block limit.",
            );
          }
        }
      }
    }
  }
  return Object.freeze(result);
}

function direction(
  blocks: readonly TesseractBlock[],
): "ltr" | "rtl" | "unknown" {
  let leftToRight = 0;
  let rightToLeft = 0;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      if (paragraph.is_ltr) leftToRight += 1;
      else rightToLeft += 1;
    }
  }
  if (leftToRight === 0 && rightToLeft === 0) return "unknown";
  return leftToRight >= rightToLeft ? "ltr" : "rtl";
}

async function recognizeWithTesseract(options: {
  readonly image: Uint8Array;
  readonly modelBytes: Uint8Array;
  readonly modelCode: string;
  readonly signal: AbortSignal;
}): Promise<TesseractRecognitionResult> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const terminateOnAbort = (): void => {
    void worker?.terminate();
  };
  options.signal.addEventListener("abort", terminateOnAbort, { once: true });
  try {
    options.signal.throwIfAborted();
    worker = await createWorker(
      [{ code: options.modelCode, data: Uint8Array.from(options.modelBytes) }],
      OEM.LSTM_ONLY,
      {
        cacheMethod: "none",
        gzip: false,
        logger: () => undefined,
        errorHandler: () => undefined,
      },
    );
    options.signal.throwIfAborted();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });
    const recognized = await worker.recognize(
      options.image,
      { rotateAuto: true },
      { text: true, blocks: true },
    );
    options.signal.throwIfAborted();
    return Object.freeze({
      text: recognized.data.text,
      confidence: recognized.data.confidence,
      blocks: Object.freeze(
        (recognized.data.blocks ?? []) as unknown as readonly TesseractBlock[],
      ),
    });
  } finally {
    options.signal.removeEventListener("abort", terminateOnAbort);
    await worker?.terminate();
  }
}

export function createTesseractTextExtractAdapter(options?: {
  readonly recognize?: TesseractRecognizer;
}): WorkerAdapter {
  const recognize = options?.recognize ?? recognizeWithTesseract;
  return Object.freeze({
    adapterKey: tesseractTextExtractAdapterKey,
    async execute(
      value: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const model = tesseractModelConfiguration(context);
      const input = requireInput(value, model);
      const resource = context.modelResource!;
      const source = await context.inputArtifacts.open({
        inputPointer: "/sourceArtifactId",
      });
      const [sourceBytes, modelBytes] = await Promise.all([
        consumeSource(source.body, signal, model.maximumSourceBytes),
        resource.read(signal),
      ]);
      let normalized: Buffer | undefined;
      try {
        if (
          createHash("sha256").update(sourceBytes).digest("hex") !==
          source.sha256
        ) {
          throw new Error("Image text-extract source digest is inconsistent.");
        }
        const image = await sharp(sourceBytes, {
          failOn: "warning",
          limitInputPixels: model.maximumSourcePixels,
        })
          .rotate()
          .png()
          .toBuffer({ resolveWithObject: true });
        normalized = image.data;
        const recognized = await recognize({
          image: normalized,
          modelBytes,
          modelCode: model.modelCode,
          signal,
        });
        signal.throwIfAborted();
        const blocks = flattenBlocks(recognized.blocks, input.granularity);
        const resultConfidence = confidence(recognized.confidence);
        return Object.freeze({
          protocol: "kanvas.worker-adapter-result/v1" as const,
          capabilityOutput: Object.freeze({
            schemaVersion: "kanvas.image-text-extract-result/v1",
            sourceArtifactId: input.sourceArtifactId,
            sourceWidth: image.info.width,
            sourceHeight: image.info.height,
            text: recognized.text.trim(),
            language: input.language,
            direction: direction(recognized.blocks),
            confidence: resultConfidence,
            blocks,
            regions: Object.freeze(
              blocks.map((block) => Object.freeze({ points: block.polygon })),
            ),
            qualitySignals: Object.freeze({
              schemaVersion: "kanvas.image-text-extract-quality/v1",
              method: "tesseract_wasm_lstm",
              generative: false,
              lowConfidence: resultConfidence < input.minimumConfidence,
            }),
          }),
          outputs: Object.freeze([]),
        });
      } finally {
        sourceBytes.fill(0);
        modelBytes.fill(0);
        normalized?.fill(0);
      }
    },
  });
}

export const tesseractTextExtractAdapter = createTesseractTextExtractAdapter();
