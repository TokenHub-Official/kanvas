import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

export const backgroundRemoveEvalCategories = Object.freeze([
  "person",
  "product",
  "animal",
  "hair_or_fur",
  "transparent_or_translucent",
  "shadow",
  "low_contrast",
  "complex_background",
  "multiple_subjects",
  "small_subject",
  "large_image",
  "unsupported_media",
] as const);

export type BackgroundRemoveEvalCategory =
  (typeof backgroundRemoveEvalCategories)[number];
export type DesignerDecision =
  "direct_use" | "mask_repair" | "fail_or_fallback";
export type EvalTarget = "browser" | "worker";

export interface BackgroundRemoveEvalSample {
  readonly id: string;
  readonly categories: readonly BackgroundRemoveEvalCategory[];
  readonly sourceFile: string;
  readonly groundTruthMaskFile?: string;
  readonly annotation: {
    readonly decision: DesignerDecision;
    readonly currentTool: string;
    readonly manualMinutes: number;
    readonly reworkReason?: string;
  };
}

export interface BackgroundRemoveEvalThresholds {
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly minimumMeanBoundaryF1: number;
  readonly minimumMeanIou: number;
  readonly maximumFailureRate: number;
  readonly maximumFallbackRate: number;
  readonly maximumP95LatencyMs: {
    readonly browser: number;
    readonly worker: number;
  };
}

export interface BackgroundRemoveEvalCorpus {
  readonly schemaVersion: "kanvas.background-remove-eval-corpus/v1";
  readonly corpusId: string;
  readonly anonymized: true;
  readonly samples: readonly BackgroundRemoveEvalSample[];
  readonly thresholds?: BackgroundRemoveEvalThresholds;
}

export interface BackgroundRemoveEvalResultSample {
  readonly id: string;
  readonly status: "succeeded" | "failed" | "fallback";
  readonly latencyMs: number;
  readonly peakMemoryBytes?: number;
  readonly maskFile?: string;
  readonly failureCode?: string;
  readonly fallbackReason?: string;
}

export interface BackgroundRemoveEvalResults {
  readonly schemaVersion: "kanvas.background-remove-eval-results/v1";
  readonly target: EvalTarget;
  readonly implementationDigest: string;
  readonly modelDigest: string;
  readonly generatedAt: string;
  readonly samples: readonly BackgroundRemoveEvalResultSample[];
}

export interface BinaryMaskMetrics {
  readonly boundaryF1: number;
  readonly foregroundIou: number;
}

export interface BackgroundRemoveTargetReport {
  readonly target: EvalTarget;
  readonly implementationDigest: string;
  readonly modelDigest: string;
  readonly sampleCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly fallbackCount: number;
  readonly failureRate: number;
  readonly fallbackRate: number;
  readonly meanForegroundIou?: number;
  readonly meanBoundaryF1?: number;
  readonly p95LatencyMs: number;
  readonly maximumPeakMemoryBytes?: number;
}

export interface BackgroundRemoveEvalReport {
  readonly schemaVersion: "kanvas.background-remove-eval-report/v1";
  readonly corpusId: string;
  readonly generatedAt: string;
  readonly designerBaseline: {
    readonly directUseCount: number;
    readonly maskRepairCount: number;
    readonly failOrFallbackCount: number;
    readonly totalManualMinutes: number;
  };
  readonly browser: BackgroundRemoveTargetReport;
  readonly worker: BackgroundRemoveTargetReport;
  readonly acceptance:
    | {
        readonly status: "pending_threshold_approval";
      }
    | {
        readonly status: "passed" | "failed";
        readonly approvedBy: string;
        readonly approvedAt: string;
        readonly failures: readonly string[];
      };
}

const sampleIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function finiteRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function requireThresholds(
  value: unknown,
): BackgroundRemoveEvalThresholds | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isRecord(value.maximumP95LatencyMs)) {
    throw new TypeError("Eval thresholds are invalid.");
  }
  const approvedBy = value.approvedBy;
  const approvedAt = value.approvedAt;
  const browserLatency = value.maximumP95LatencyMs.browser;
  const workerLatency = value.maximumP95LatencyMs.worker;
  if (
    typeof approvedBy !== "string" ||
    approvedBy.trim().length === 0 ||
    approvedBy.length > 160 ||
    typeof approvedAt !== "string" ||
    !Number.isFinite(Date.parse(approvedAt)) ||
    !finiteRate(value.minimumMeanIou) ||
    !finiteRate(value.minimumMeanBoundaryF1) ||
    !finiteRate(value.maximumFailureRate) ||
    !finiteRate(value.maximumFallbackRate) ||
    typeof browserLatency !== "number" ||
    !Number.isFinite(browserLatency) ||
    browserLatency <= 0 ||
    typeof workerLatency !== "number" ||
    !Number.isFinite(workerLatency) ||
    workerLatency <= 0
  ) {
    throw new TypeError(
      "Eval thresholds require explicit designer approval and bounded values.",
    );
  }
  return {
    approvedBy: approvedBy.trim(),
    approvedAt,
    minimumMeanIou: value.minimumMeanIou,
    minimumMeanBoundaryF1: value.minimumMeanBoundaryF1,
    maximumFailureRate: value.maximumFailureRate,
    maximumFallbackRate: value.maximumFallbackRate,
    maximumP95LatencyMs: {
      browser: browserLatency,
      worker: workerLatency,
    },
  };
}

export function parseBackgroundRemoveEvalCorpus(
  value: unknown,
): BackgroundRemoveEvalCorpus {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "kanvas.background-remove-eval-corpus/v1" ||
    value.anonymized !== true ||
    typeof value.corpusId !== "string" ||
    !sampleIdPattern.test(value.corpusId) ||
    !Array.isArray(value.samples) ||
    value.samples.length < 30 ||
    value.samples.length > 50
  ) {
    throw new TypeError(
      "Background-removal Eval corpus must contain 30-50 anonymized samples.",
    );
  }
  const ids = new Set<string>();
  const covered = new Set<BackgroundRemoveEvalCategory>();
  const samples = value.samples.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !sampleIdPattern.test(candidate.id) ||
      ids.has(candidate.id) ||
      !Array.isArray(candidate.categories) ||
      candidate.categories.length === 0 ||
      !safeRelativePath(candidate.sourceFile) ||
      (candidate.groundTruthMaskFile !== undefined &&
        !safeRelativePath(candidate.groundTruthMaskFile)) ||
      !isRecord(candidate.annotation)
    ) {
      throw new TypeError("Eval sample is invalid.");
    }
    const categories = candidate.categories as unknown[];
    if (
      categories.some(
        (category) =>
          typeof category !== "string" ||
          !backgroundRemoveEvalCategories.includes(
            category as BackgroundRemoveEvalCategory,
          ),
      )
    ) {
      throw new TypeError("Eval sample contains an unsupported category.");
    }
    const decision = candidate.annotation.decision;
    const currentTool = candidate.annotation.currentTool;
    const manualMinutes = candidate.annotation.manualMinutes;
    const reworkReason = candidate.annotation.reworkReason;
    if (
      decision !== "direct_use" &&
      decision !== "mask_repair" &&
      decision !== "fail_or_fallback"
    ) {
      throw new TypeError("Eval sample requires a designer decision.");
    }
    if (
      typeof currentTool !== "string" ||
      currentTool.trim().length === 0 ||
      currentTool.length > 160 ||
      typeof manualMinutes !== "number" ||
      !Number.isFinite(manualMinutes) ||
      manualMinutes < 0 ||
      manualMinutes > 1_440 ||
      (reworkReason !== undefined &&
        (typeof reworkReason !== "string" ||
          reworkReason.trim().length === 0 ||
          reworkReason.length > 500))
    ) {
      throw new TypeError("Eval sample baseline annotation is invalid.");
    }
    if (decision !== "fail_or_fallback" && !candidate.groundTruthMaskFile) {
      throw new TypeError(
        "Usable Eval samples require a designer ground-truth Mask.",
      );
    }
    ids.add(candidate.id);
    for (const category of categories) {
      covered.add(category as BackgroundRemoveEvalCategory);
    }
    return {
      id: candidate.id,
      categories: categories as BackgroundRemoveEvalCategory[],
      sourceFile: candidate.sourceFile,
      ...(typeof candidate.groundTruthMaskFile === "string"
        ? {
            groundTruthMaskFile: candidate.groundTruthMaskFile,
          }
        : {}),
      annotation: {
        decision,
        currentTool: currentTool.trim(),
        manualMinutes,
        ...(typeof reworkReason === "string"
          ? { reworkReason: reworkReason.trim() }
          : {}),
      },
    } satisfies BackgroundRemoveEvalSample;
  });
  const missing = backgroundRemoveEvalCategories.filter(
    (category) => !covered.has(category),
  );
  if (missing.length > 0) {
    throw new TypeError(
      `Eval corpus is missing required categories: ${missing.join(", ")}.`,
    );
  }
  const thresholds = requireThresholds(value.thresholds);
  return Object.freeze({
    schemaVersion: "kanvas.background-remove-eval-corpus/v1",
    corpusId: value.corpusId,
    anonymized: true,
    samples: Object.freeze(samples),
    ...(thresholds ? { thresholds } : {}),
  });
}

export function parseBackgroundRemoveEvalResults(
  value: unknown,
  target: EvalTarget,
  sampleIds: ReadonlySet<string>,
): BackgroundRemoveEvalResults {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "kanvas.background-remove-eval-results/v1" ||
    value.target !== target ||
    typeof value.implementationDigest !== "string" ||
    !digestPattern.test(value.implementationDigest) ||
    typeof value.modelDigest !== "string" ||
    !digestPattern.test(value.modelDigest) ||
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.samples) ||
    value.samples.length !== sampleIds.size
  ) {
    throw new TypeError(`${target} Eval results are invalid.`);
  }
  const observedIds = new Set<string>();
  const samples = value.samples.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !sampleIds.has(candidate.id) ||
      observedIds.has(candidate.id) ||
      (candidate.status !== "succeeded" &&
        candidate.status !== "failed" &&
        candidate.status !== "fallback") ||
      typeof candidate.latencyMs !== "number" ||
      !Number.isFinite(candidate.latencyMs) ||
      candidate.latencyMs < 0 ||
      (candidate.peakMemoryBytes !== undefined &&
        (typeof candidate.peakMemoryBytes !== "number" ||
          !Number.isSafeInteger(candidate.peakMemoryBytes) ||
          candidate.peakMemoryBytes < 0))
    ) {
      throw new TypeError(`${target} Eval result sample is invalid.`);
    }
    if (
      candidate.status === "succeeded" &&
      !safeRelativePath(candidate.maskFile)
    ) {
      throw new TypeError(`${target} successful Eval result requires a Mask.`);
    }
    if (
      candidate.status === "failed" &&
      (typeof candidate.failureCode !== "string" ||
        candidate.failureCode.length === 0 ||
        candidate.failureCode.length > 160)
    ) {
      throw new TypeError(
        `${target} failed Eval result requires a failure code.`,
      );
    }
    if (
      candidate.status === "fallback" &&
      (typeof candidate.fallbackReason !== "string" ||
        candidate.fallbackReason.length === 0 ||
        candidate.fallbackReason.length > 240)
    ) {
      throw new TypeError(`${target} fallback result requires a reason.`);
    }
    observedIds.add(candidate.id);
    return candidate as unknown as BackgroundRemoveEvalResultSample;
  });
  return Object.freeze({
    schemaVersion: "kanvas.background-remove-eval-results/v1",
    target,
    implementationDigest: value.implementationDigest,
    modelDigest: value.modelDigest,
    generatedAt: value.generatedAt,
    samples: Object.freeze(samples),
  });
}

function boundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] !== 1) {
        continue;
      }
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (
          nextX < 0 ||
          nextY < 0 ||
          nextX >= width ||
          nextY >= height ||
          mask[nextY * width + nextX] !== 1
        ) {
          result[index] = 1;
          break;
        }
      }
    }
  }
  return result;
}

function boundaryMatches(
  source: Uint8Array,
  target: Uint8Array,
  width: number,
  height: number,
  tolerance: number,
): number {
  let matches = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== 1) {
      continue;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    let matched = false;
    for (let dy = -tolerance; dy <= tolerance && !matched; dy += 1) {
      for (let dx = -tolerance; dx <= tolerance; dx += 1) {
        const targetX = x + dx;
        const targetY = y + dy;
        if (
          targetX >= 0 &&
          targetY >= 0 &&
          targetX < width &&
          targetY < height &&
          target[targetY * width + targetX] === 1
        ) {
          matched = true;
          break;
        }
      }
    }
    if (matched) {
      matches += 1;
    }
  }
  return matches;
}

function count(mask: Uint8Array): number {
  let result = 0;
  for (const value of mask) {
    result += value === 1 ? 1 : 0;
  }
  return result;
}

export function measureBinaryMasks(options: {
  readonly predicted: Uint8Array;
  readonly expected: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly boundaryTolerance?: number;
}): BinaryMaskMetrics {
  const pixelCount = options.width * options.height;
  if (
    options.width < 1 ||
    options.height < 1 ||
    options.predicted.length !== pixelCount ||
    options.expected.length !== pixelCount ||
    options.predicted.some((value) => value !== 0 && value !== 1) ||
    options.expected.some((value) => value !== 0 && value !== 1)
  ) {
    throw new TypeError("Binary Mask dimensions or values are invalid.");
  }
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const predicted = options.predicted[index] === 1;
    const expected = options.expected[index] === 1;
    intersection += predicted && expected ? 1 : 0;
    union += predicted || expected ? 1 : 0;
  }
  const predictedBoundary = boundary(
    options.predicted,
    options.width,
    options.height,
  );
  const expectedBoundary = boundary(
    options.expected,
    options.width,
    options.height,
  );
  const predictedBoundaryCount = count(predictedBoundary);
  const expectedBoundaryCount = count(expectedBoundary);
  const tolerance = options.boundaryTolerance ?? 2;
  let precision = expectedBoundaryCount === 0 ? 1 : 0;
  if (predictedBoundaryCount > 0) {
    precision =
      boundaryMatches(
        predictedBoundary,
        expectedBoundary,
        options.width,
        options.height,
        tolerance,
      ) / predictedBoundaryCount;
  }
  let recall = predictedBoundaryCount === 0 ? 1 : 0;
  if (expectedBoundaryCount > 0) {
    recall =
      boundaryMatches(
        expectedBoundary,
        predictedBoundary,
        options.width,
        options.height,
        tolerance,
      ) / expectedBoundaryCount;
  }
  return Object.freeze({
    foregroundIou: union === 0 ? 1 : intersection / union,
    boundaryF1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
  });
}

async function binaryMask(path: string): Promise<{
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}> {
  const { data, info } = await sharp(path, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Object.freeze({
    width: info.width,
    height: info.height,
    pixels: Uint8Array.from(data, (value) => (value >= 128 ? 1 : 0)),
  });
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  ]!;
}

async function targetReport(options: {
  readonly corpus: BackgroundRemoveEvalCorpus;
  readonly corpusRoot: string;
  readonly resultRoot: string;
  readonly results: BackgroundRemoveEvalResults;
}): Promise<BackgroundRemoveTargetReport> {
  const metrics: BinaryMaskMetrics[] = [];
  for (const result of options.results.samples) {
    if (result.status !== "succeeded" || !result.maskFile) {
      continue;
    }
    const sample = options.corpus.samples.find(
      (candidate) => candidate.id === result.id,
    );
    if (!sample?.groundTruthMaskFile) {
      continue;
    }
    const [predicted, expected] = await Promise.all([
      binaryMask(resolve(options.resultRoot, result.maskFile)),
      binaryMask(resolve(options.corpusRoot, sample.groundTruthMaskFile)),
    ]);
    if (
      predicted.width !== expected.width ||
      predicted.height !== expected.height
    ) {
      throw new Error(`Eval Mask dimensions differ for ${result.id}.`);
    }
    metrics.push(
      measureBinaryMasks({
        predicted: predicted.pixels,
        expected: expected.pixels,
        width: predicted.width,
        height: predicted.height,
      }),
    );
  }
  const failedCount = options.results.samples.filter(
    (sample) => sample.status === "failed",
  ).length;
  const fallbackCount = options.results.samples.filter(
    (sample) => sample.status === "fallback",
  ).length;
  const succeededCount = options.results.samples.filter(
    (sample) => sample.status === "succeeded",
  ).length;
  const peakMemory = options.results.samples.flatMap((sample) =>
    sample.peakMemoryBytes === undefined ? [] : [sample.peakMemoryBytes],
  );
  const meanIou = mean(metrics.map((value) => value.foregroundIou));
  const meanBoundaryF1 = mean(metrics.map((value) => value.boundaryF1));
  return Object.freeze({
    target: options.results.target,
    implementationDigest: options.results.implementationDigest,
    modelDigest: options.results.modelDigest,
    sampleCount: options.results.samples.length,
    succeededCount,
    failedCount,
    fallbackCount,
    failureRate: failedCount / options.results.samples.length,
    fallbackRate: fallbackCount / options.results.samples.length,
    ...(meanIou === undefined ? {} : { meanForegroundIou: meanIou }),
    ...(meanBoundaryF1 === undefined ? {} : { meanBoundaryF1 }),
    p95LatencyMs: percentile95(
      options.results.samples.map((sample) => sample.latencyMs),
    ),
    ...(peakMemory.length === 0
      ? {}
      : {
          maximumPeakMemoryBytes: Math.max(...peakMemory),
        }),
  });
}

function thresholdFailures(
  report: BackgroundRemoveTargetReport,
  thresholds: BackgroundRemoveEvalThresholds,
): string[] {
  const failures: string[] = [];
  if (
    report.meanForegroundIou === undefined ||
    report.meanForegroundIou < thresholds.minimumMeanIou
  ) {
    failures.push(`${report.target}.meanForegroundIou`);
  }
  if (
    report.meanBoundaryF1 === undefined ||
    report.meanBoundaryF1 < thresholds.minimumMeanBoundaryF1
  ) {
    failures.push(`${report.target}.meanBoundaryF1`);
  }
  if (report.failureRate > thresholds.maximumFailureRate) {
    failures.push(`${report.target}.failureRate`);
  }
  if (report.fallbackRate > thresholds.maximumFallbackRate) {
    failures.push(`${report.target}.fallbackRate`);
  }
  if (report.p95LatencyMs > thresholds.maximumP95LatencyMs[report.target]) {
    failures.push(`${report.target}.p95LatencyMs`);
  }
  return failures;
}

export async function evaluateBackgroundRemoval(options: {
  readonly corpus: BackgroundRemoveEvalCorpus;
  readonly corpusPath: string;
  readonly browserResults: BackgroundRemoveEvalResults;
  readonly browserResultsPath: string;
  readonly workerResults: BackgroundRemoveEvalResults;
  readonly workerResultsPath: string;
  readonly now?: Date;
}): Promise<BackgroundRemoveEvalReport> {
  const [browser, worker] = await Promise.all([
    targetReport({
      corpus: options.corpus,
      corpusRoot: dirname(options.corpusPath),
      resultRoot: dirname(options.browserResultsPath),
      results: options.browserResults,
    }),
    targetReport({
      corpus: options.corpus,
      corpusRoot: dirname(options.corpusPath),
      resultRoot: dirname(options.workerResultsPath),
      results: options.workerResults,
    }),
  ]);
  const baseline = {
    directUseCount: options.corpus.samples.filter(
      (sample) => sample.annotation.decision === "direct_use",
    ).length,
    maskRepairCount: options.corpus.samples.filter(
      (sample) => sample.annotation.decision === "mask_repair",
    ).length,
    failOrFallbackCount: options.corpus.samples.filter(
      (sample) => sample.annotation.decision === "fail_or_fallback",
    ).length,
    totalManualMinutes: options.corpus.samples.reduce(
      (sum, sample) => sum + sample.annotation.manualMinutes,
      0,
    ),
  };
  const thresholds = options.corpus.thresholds;
  const failures = thresholds
    ? [
        ...thresholdFailures(browser, thresholds),
        ...thresholdFailures(worker, thresholds),
      ]
    : [];
  return Object.freeze({
    schemaVersion: "kanvas.background-remove-eval-report/v1",
    corpusId: options.corpus.corpusId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    designerBaseline: Object.freeze(baseline),
    browser,
    worker,
    acceptance: thresholds
      ? Object.freeze({
          status: failures.length === 0 ? "passed" : "failed",
          approvedBy: thresholds.approvedBy,
          approvedAt: thresholds.approvedAt,
          failures: Object.freeze(failures),
        })
      : Object.freeze({
          status: "pending_threshold_approval" as const,
        }),
  });
}

export async function readEvalJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
