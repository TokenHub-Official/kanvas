import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import sharp from "sharp";

import {
  evaluateBackgroundCompose,
  evaluateBatchCThresholds,
  evaluateCropSuggest,
  evaluatePaletteExtract,
  evaluateQualityAssess,
  type CropEvalDocument,
  type CropGroundTruth,
  type PaletteEvalDocument,
  type QualityEvalDocument,
} from "./batch-c-eval.js";
import type { MetricThresholds, RgbaImage } from "./eval.js";

type Capability =
  | "image.crop.suggest"
  | "image.palette.extract"
  | "image.quality.assess"
  | "image.background.compose";

interface Sample {
  readonly candidateFile: string;
  readonly candidateMaskFile?: string;
  readonly capability: Capability;
  readonly categories: readonly string[];
  readonly expectedFile: string;
  readonly expectedMaskFile?: string;
  readonly id: string;
  readonly implementationDigest: string;
  readonly target: "browser" | "worker";
  readonly thresholds: MetricThresholds;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const keyPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function thresholds(value: unknown): MetricThresholds {
  const input = record(value, "thresholds");
  if (Object.keys(input).length < 1) {
    throw new TypeError("Eval samples require explicit thresholds.");
  }
  const result: Record<
    string,
    {
      readonly operator: "gte" | "lte" | "eq";
      readonly value: number;
    }
  > = {};
  for (const [metric, raw] of Object.entries(input)) {
    const item = record(raw, `thresholds.${metric}`);
    if (
      !/^[a-z][A-Za-z0-9]{0,79}$/u.test(metric) ||
      (item.operator !== "gte" &&
        item.operator !== "lte" &&
        item.operator !== "eq") ||
      typeof item.value !== "number" ||
      !Number.isFinite(item.value)
    ) {
      throw new TypeError(`Threshold ${metric} is invalid.`);
    }
    result[metric] = {
      operator: item.operator,
      value: item.value,
    };
  }
  return Object.freeze(result);
}

function parseSample(value: unknown, ids: Set<string>): Sample {
  const input = record(value, "sample");
  const capability = input.capability;
  const compose = capability === "image.background.compose";
  if (
    typeof input.id !== "string" ||
    !keyPattern.test(input.id) ||
    ids.has(input.id) ||
    (capability !== "image.crop.suggest" &&
      capability !== "image.palette.extract" &&
      capability !== "image.quality.assess" &&
      !compose) ||
    (input.target !== "browser" && input.target !== "worker") ||
    typeof input.implementationDigest !== "string" ||
    !digestPattern.test(input.implementationDigest) ||
    !safeFile(input.candidateFile) ||
    !safeFile(input.expectedFile) ||
    (compose &&
      (!safeFile(input.candidateMaskFile) ||
        !safeFile(input.expectedMaskFile))) ||
    !Array.isArray(input.categories) ||
    input.categories.length < 1 ||
    input.categories.some(
      (category) => typeof category !== "string" || !keyPattern.test(category),
    )
  ) {
    throw new TypeError("Batch C Eval sample is invalid.");
  }
  ids.add(input.id);
  return Object.freeze({
    id: input.id,
    capability,
    target: input.target,
    implementationDigest: input.implementationDigest,
    categories: Object.freeze([...(input.categories as string[])]),
    candidateFile: input.candidateFile,
    expectedFile: input.expectedFile,
    ...(compose
      ? {
          candidateMaskFile: input.candidateMaskFile as string,
          expectedMaskFile: input.expectedMaskFile as string,
        }
      : {}),
    thresholds: thresholds(input.thresholds),
  });
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

function pathInside(root: string, file: string): string {
  const path = resolve(root, file);
  const child = relative(root, path);
  if (child === "" || child.startsWith("..") || child === path) {
    throw new Error(`Eval file ${file} escaped its corpus.`);
  }
  return path;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function image(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path, {
    failOn: "warning",
    limitInputPixels: 100_000_000,
  })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Object.freeze({
    data,
    width: info.width,
    height: info.height,
  });
}

async function sha256(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

async function evaluate(root: string, sample: Sample) {
  const candidate = pathInside(root, sample.candidateFile);
  const expected = pathInside(root, sample.expectedFile);
  let metrics: Readonly<Record<string, number>>;
  const files = [candidate, expected];
  if (sample.capability === "image.crop.suggest") {
    metrics = evaluateCropSuggest(
      await json<CropEvalDocument>(candidate),
      await json<CropGroundTruth>(expected),
    );
  } else if (sample.capability === "image.palette.extract") {
    metrics = evaluatePaletteExtract(
      await json<PaletteEvalDocument>(candidate),
      await json<PaletteEvalDocument>(expected),
    );
  } else if (sample.capability === "image.quality.assess") {
    metrics = evaluateQualityAssess(
      await json<QualityEvalDocument>(candidate),
      await json<QualityEvalDocument>(expected),
    );
  } else {
    const candidateMask = pathInside(root, sample.candidateMaskFile!);
    const expectedMask = pathInside(root, sample.expectedMaskFile!);
    files.push(candidateMask, expectedMask);
    const [
      candidateImage,
      expectedImage,
      candidateMaskImage,
      expectedMaskImage,
    ] = await Promise.all([
      image(candidate),
      image(expected),
      image(candidateMask),
      image(expectedMask),
    ]);
    metrics = evaluateBackgroundCompose({
      candidate: candidateImage,
      expected: expectedImage,
      candidateMask: candidateMaskImage,
      expectedMask: expectedMaskImage,
    });
  }
  const inputDigests: Record<string, string> = {};
  await Promise.all(
    files.map(async (path) => {
      inputDigests[relative(root, path)] = await sha256(path);
    }),
  );
  return Object.freeze({
    id: sample.id,
    capability: sample.capability,
    target: sample.target,
    implementationDigest: sample.implementationDigest,
    categories: sample.categories,
    metrics,
    thresholds: sample.thresholds,
    inputDigests,
    ...evaluateBatchCThresholds(metrics, sample.thresholds),
  });
}

const manifestArgument = argument("manifest");
if (!manifestArgument) {
  throw new Error("Usage: eval:batch-c --manifest=path [--out=path]");
}
const manifestPath = resolve(manifestArgument);
const manifest = record(
  await json<unknown>(manifestPath),
  "Batch C Eval manifest",
);
if (
  manifest.schemaVersion !== "kanvas.image-atomic-batch-c-eval/v1" ||
  manifest.anonymized !== true ||
  (manifest.evidenceClass !== "designer_approved" &&
    manifest.evidenceClass !== "metric_regression") ||
  typeof manifest.corpusId !== "string" ||
  !keyPattern.test(manifest.corpusId) ||
  !Array.isArray(manifest.samples) ||
  manifest.samples.length < 1 ||
  manifest.samples.length > 500
) {
  throw new TypeError(
    "Batch C Eval manifest identity or sample count is invalid.",
  );
}
const ids = new Set<string>();
const samples = manifest.samples.map((sample) => parseSample(sample, ids));
const root = dirname(manifestPath);
const results = [];
for (const sample of samples) {
  results.push(await evaluate(root, sample));
}
const report = {
  schemaVersion: "kanvas.image-atomic-batch-c-eval-report/v1",
  corpusId: manifest.corpusId,
  evidenceClass: manifest.evidenceClass,
  generatedAt: new Date().toISOString(),
  sampleCount: results.length,
  passedCount: results.filter(({ passed }) => passed).length,
  failedCount: results.filter(({ passed }) => !passed).length,
  passed: results.every(({ passed }) => passed),
  samples: results,
};
const outputPath = resolve(argument("out") ?? resolve(root, "report.json"));
await mkdir(dirname(outputPath), {
  recursive: true,
});
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({
    report: outputPath,
    sampleCount: report.sampleCount,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    passed: report.passed,
  })}\n`,
);
if (!report.passed) {
  process.exitCode = 1;
}
