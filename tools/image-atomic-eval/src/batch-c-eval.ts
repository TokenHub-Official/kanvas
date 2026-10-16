import {
  evaluateThresholds,
  type EvalDecision,
  type MetricThresholds,
  type RgbaImage,
} from "./eval.js";

export interface Bounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface CropEvalDocument {
  readonly suggestions: readonly {
    readonly aspectRatio: string;
    readonly bounds: Bounds;
    readonly rank: number;
    readonly subjectRetention: number;
  }[];
}

export interface CropGroundTruth {
  readonly preferred: readonly {
    readonly aspectRatio: string;
    readonly bounds: Bounds;
  }[];
}

export interface PaletteEvalDocument {
  readonly colors: readonly {
    readonly blue: number;
    readonly green: number;
    readonly proportion: number;
    readonly red: number;
  }[];
}

export interface QualityEvalDocument {
  readonly blurScore: number;
  readonly compressionScore: number;
  readonly findings: readonly string[];
  readonly noiseScore: number;
  readonly overExposureRatio: number;
  readonly underExposureRatio: number;
  readonly usability: "good" | "review" | "poor";
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function boundsIou(left: Bounds, right: Bounds): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  const intersection = width * height;
  const union =
    left.width * left.height + right.width * right.height - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function evaluateCropSuggest(
  candidate: CropEvalDocument,
  expected: CropGroundTruth,
): Readonly<Record<string, number>> {
  const topIous: number[] = [];
  const topThreeHits: number[] = [];
  const subjectRetentions: number[] = [];
  for (const truth of expected.preferred) {
    const suggestions = candidate.suggestions
      .filter(({ aspectRatio }) => aspectRatio === truth.aspectRatio)
      .sort((left, right) => left.rank - right.rank);
    topIous.push(
      suggestions[0] ? boundsIou(suggestions[0].bounds, truth.bounds) : 0,
    );
    topThreeHits.push(
      suggestions
        .slice(0, 3)
        .some(({ bounds }) => boundsIou(bounds, truth.bounds) >= 0.75)
        ? 1
        : 0,
    );
    subjectRetentions.push(suggestions[0]?.subjectRetention ?? 0);
  }
  return Object.freeze({
    meanTopOneIou: rounded(mean(topIous)),
    topThreeHitRate: rounded(mean(topThreeHits)),
    meanSubjectRetention: rounded(mean(subjectRetentions)),
  });
}

function colorDistance(
  left: PaletteEvalDocument["colors"][number],
  right: PaletteEvalDocument["colors"][number],
): number {
  return (
    Math.hypot(
      left.red - right.red,
      left.green - right.green,
      left.blue - right.blue,
    ) / Math.sqrt(3 * 255 * 255)
  );
}

export function evaluatePaletteExtract(
  candidate: PaletteEvalDocument,
  expected: PaletteEvalDocument,
): Readonly<Record<string, number>> {
  let weightedDistance = 0;
  let proportionError = 0;
  let expectedWeight = 0;
  for (const truth of expected.colors) {
    const nearest = candidate.colors
      .map((color) => ({
        color,
        distance: colorDistance(color, truth),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    const weight = Math.max(0, truth.proportion);
    weightedDistance += (nearest?.distance ?? 1) * weight;
    proportionError +=
      Math.abs((nearest?.color.proportion ?? 0) - truth.proportion) * weight;
    expectedWeight += weight;
  }
  let normalizedDistance = candidate.colors.length === 0 ? 0 : 1;
  if (expectedWeight > 0) {
    normalizedDistance = weightedDistance / expectedWeight;
  }
  const normalizedProportion =
    expectedWeight === 0 ? 0 : proportionError / expectedWeight;
  return Object.freeze({
    weightedColorDistance: rounded(normalizedDistance),
    weightedProportionError: rounded(normalizedProportion),
    paletteCoverage: rounded(Math.max(0, 1 - normalizedDistance)),
  });
}

export function evaluateQualityAssess(
  candidate: QualityEvalDocument,
  expected: QualityEvalDocument,
): Readonly<Record<string, number>> {
  const scoreKeys = [
    "blurScore",
    "compressionScore",
    "noiseScore",
    "overExposureRatio",
    "underExposureRatio",
  ] as const;
  const scoreMae = mean(
    scoreKeys.map((key) => Math.abs(candidate[key] - expected[key])),
  );
  const candidateFindings = new Set(candidate.findings);
  const expectedFindings = new Set(expected.findings);
  const truePositive = [...candidateFindings].filter((finding) =>
    expectedFindings.has(finding),
  ).length;
  let precision = expectedFindings.size === 0 ? 1 : 0;
  if (candidateFindings.size > 0) {
    precision = truePositive / candidateFindings.size;
  }
  let recall = candidateFindings.size === 0 ? 1 : 0;
  if (expectedFindings.size > 0) {
    recall = truePositive / expectedFindings.size;
  }
  return Object.freeze({
    scoreMae: rounded(scoreMae),
    findingPrecision: rounded(precision),
    findingRecall: rounded(recall),
    findingF1: rounded(
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
    ),
    usabilityMatch: candidate.usability === expected.usability ? 1 : 0,
  });
}

function assertSame(left: RgbaImage, right: RgbaImage, label: string): void {
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.data.length !== right.data.length ||
    left.data.length !== left.width * left.height * 4
  ) {
    throw new TypeError(`Compose Eval ${label} dimensions differ.`);
  }
}

function maskIou(candidate: RgbaImage, expected: RgbaImage): number {
  assertSame(candidate, expected, "Mask");
  let intersection = 0;
  let union = 0;
  for (let offset = 0; offset < candidate.data.length; offset += 4) {
    const left = candidate.data[offset]! >= 128;
    const right = expected.data[offset]! >= 128;
    if (left && right) intersection += 1;
    if (left || right) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

export function evaluateBackgroundCompose(options: {
  readonly candidate: RgbaImage;
  readonly candidateMask: RgbaImage;
  readonly expected: RgbaImage;
  readonly expectedMask: RgbaImage;
}): Readonly<Record<string, number>> {
  assertSame(options.candidate, options.expected, "image");
  let absolute = 0;
  let exact = 0;
  let alphaExact = 0;
  const pixels = options.candidate.width * options.candidate.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    let pixelExact = true;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        options.candidate.data[offset + channel]! -
          options.expected.data[offset + channel]!,
      );
      absolute += delta;
      if (delta !== 0) pixelExact = false;
    }
    if (pixelExact) exact += 1;
    if (
      options.candidate.data[offset + 3] === options.expected.data[offset + 3]
    ) {
      alphaExact += 1;
    }
  }
  return Object.freeze({
    pixelExactRatio: rounded(exact / pixels),
    channelMae: rounded(absolute / (pixels * 4)),
    alphaExactRatio: rounded(alphaExact / pixels),
    compositionMaskIou: rounded(
      maskIou(options.candidateMask, options.expectedMask),
    ),
  });
}

export function evaluateBatchCThresholds(
  metrics: Readonly<Record<string, number>>,
  thresholds: MetricThresholds,
): EvalDecision {
  return evaluateThresholds(metrics, thresholds);
}
