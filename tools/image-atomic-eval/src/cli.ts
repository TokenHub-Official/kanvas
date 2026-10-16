import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import sharp from "sharp";

import {
  evaluateDenoise,
  evaluateLightEnhance,
  evaluateObjectRemove,
  evaluateTextExtract,
  evaluateThresholds,
  type BatchBCapability,
  type MetricThresholds,
  type OcrEvalDocument,
  type RgbaImage,
} from "./eval.js";

interface EvalSample {
  readonly candidateFile: string;
  readonly capability: BatchBCapability;
  readonly categories: readonly string[];
  readonly expectedFile: string;
  readonly id: string;
  readonly implementationDigest: string;
  readonly maskFile?: string;
  readonly sourceFile?: string;
  readonly target: "browser" | "worker" | "provider";
  readonly thresholds: MetricThresholds;
}

interface EvalManifest {
  readonly anonymized: true;
  readonly corpusId: string;
  readonly evidenceClass: "designer_approved" | "metric_regression";
  readonly samples: readonly EvalSample[];
  readonly schemaVersion: "kanvas.image-atomic-batch-b-eval/v1";
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sampleIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const capabilities = new Set<BatchBCapability>([
  "image.object.remove",
  "image.denoise",
  "image.light.enhance",
  "image.text.extract",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativeFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function parseThresholds(value: unknown): MetricThresholds {
  if (!isRecord(value) || Object.keys(value).length < 1) {
    throw new TypeError("Every Eval sample requires explicit thresholds.");
  }
  const thresholds: Record<
    string,
    {
      readonly operator: "gte" | "lte" | "eq";
      readonly value: number;
    }
  > = {};
  for (const [metric, rawThreshold] of Object.entries(value)) {
    if (
      !/^[a-z][A-Za-z0-9]{0,79}$/u.test(metric) ||
      !isRecord(rawThreshold) ||
      !["gte", "lte", "eq"].includes(rawThreshold.operator as string) ||
      typeof rawThreshold.value !== "number" ||
      !Number.isFinite(rawThreshold.value) ||
      Object.keys(rawThreshold).some(
        (key) => !["operator", "value"].includes(key),
      )
    ) {
      throw new TypeError(`Eval threshold ${metric} is invalid.`);
    }
    thresholds[metric] = {
      operator: rawThreshold.operator as "gte" | "lte" | "eq",
      value: rawThreshold.value,
    };
  }
  return Object.freeze(thresholds);
}

function parseManifest(value: unknown): EvalManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "kanvas.image-atomic-batch-b-eval/v1" ||
    value.anonymized !== true ||
    (value.evidenceClass !== "designer_approved" &&
      value.evidenceClass !== "metric_regression") ||
    typeof value.corpusId !== "string" ||
    !sampleIdPattern.test(value.corpusId) ||
    !Array.isArray(value.samples) ||
    value.samples.length < 1 ||
    value.samples.length > 500
  ) {
    throw new TypeError(
      "Batch B Eval manifest identity or sample count is invalid.",
    );
  }
  const ids = new Set<string>();
  const samples = value.samples.map((rawSample) => {
    if (
      !isRecord(rawSample) ||
      typeof rawSample.id !== "string" ||
      !sampleIdPattern.test(rawSample.id) ||
      ids.has(rawSample.id) ||
      typeof rawSample.capability !== "string" ||
      !capabilities.has(rawSample.capability as BatchBCapability) ||
      !["browser", "worker", "provider"].includes(rawSample.target as string) ||
      typeof rawSample.implementationDigest !== "string" ||
      !digestPattern.test(rawSample.implementationDigest) ||
      !safeRelativeFile(rawSample.candidateFile) ||
      !safeRelativeFile(rawSample.expectedFile) ||
      (rawSample.sourceFile !== undefined &&
        !safeRelativeFile(rawSample.sourceFile)) ||
      (rawSample.maskFile !== undefined &&
        !safeRelativeFile(rawSample.maskFile)) ||
      !Array.isArray(rawSample.categories) ||
      rawSample.categories.length < 1 ||
      rawSample.categories.some(
        (category) =>
          typeof category !== "string" || !sampleIdPattern.test(category),
      )
    ) {
      throw new TypeError("Batch B Eval sample is invalid.");
    }
    ids.add(rawSample.id);
    return Object.freeze({
      id: rawSample.id,
      capability: rawSample.capability as BatchBCapability,
      target: rawSample.target as "browser" | "worker" | "provider",
      implementationDigest: rawSample.implementationDigest,
      categories: Object.freeze([...(rawSample.categories as string[])]),
      candidateFile: rawSample.candidateFile,
      expectedFile: rawSample.expectedFile,
      ...(rawSample.sourceFile
        ? {
            sourceFile: rawSample.sourceFile,
          }
        : {}),
      ...(rawSample.maskFile
        ? {
            maskFile: rawSample.maskFile,
          }
        : {}),
      thresholds: parseThresholds(rawSample.thresholds),
    });
  });
  return Object.freeze({
    schemaVersion: "kanvas.image-atomic-batch-b-eval/v1",
    corpusId: value.corpusId,
    evidenceClass: value.evidenceClass,
    anonymized: true,
    samples: Object.freeze(samples),
  });
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
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
  if (info.channels !== 4) {
    throw new Error(`Image ${path} did not decode as RGBA.`);
  }
  return Object.freeze({
    data,
    width: info.width,
    height: info.height,
  });
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function fileDigest(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && !child.startsWith("..") && child !== path;
}

function samplePath(root: string, file: string): string {
  const path = resolve(root, file);
  if (!inside(root, path)) {
    throw new Error(`Eval file ${file} escaped its corpus.`);
  }
  return path;
}

async function evaluateSample(root: string, sample: EvalSample) {
  const candidatePath = samplePath(root, sample.candidateFile);
  const expectedPath = samplePath(root, sample.expectedFile);
  const sourcePath = sample.sourceFile
    ? samplePath(root, sample.sourceFile)
    : undefined;
  const maskPath = sample.maskFile
    ? samplePath(root, sample.maskFile)
    : undefined;
  let metrics: Readonly<Record<string, number>>;
  if (sample.capability === "image.text.extract") {
    metrics = evaluateTextExtract({
      candidate: await json<OcrEvalDocument>(candidatePath),
      expected: await json<OcrEvalDocument>(expectedPath),
    });
  } else if (sample.capability === "image.object.remove") {
    if (!sourcePath || !maskPath) {
      throw new Error(
        `Object-remove sample ${sample.id} requires sourceFile and maskFile.`,
      );
    }
    const [candidate, expected, source, mask] = await Promise.all([
      image(candidatePath),
      image(expectedPath),
      image(sourcePath),
      image(maskPath),
    ]);
    metrics = evaluateObjectRemove({
      candidate,
      expected,
      source,
      mask,
    });
  } else if (sample.capability === "image.denoise") {
    if (!sourcePath) {
      throw new Error(`Denoise sample ${sample.id} requires sourceFile.`);
    }
    const [candidate, clean, noisy] = await Promise.all([
      image(candidatePath),
      image(expectedPath),
      image(sourcePath),
    ]);
    metrics = evaluateDenoise({
      candidate,
      clean,
      noisy,
    });
  } else {
    if (!sourcePath) {
      throw new Error(`Light-enhance sample ${sample.id} requires sourceFile.`);
    }
    const [candidate, expected, source] = await Promise.all([
      image(candidatePath),
      image(expectedPath),
      image(sourcePath),
    ]);
    metrics = evaluateLightEnhance({
      candidate,
      expected,
      source,
    });
  }
  const decision = evaluateThresholds(metrics, sample.thresholds);
  const evidenceFiles = [
    candidatePath,
    expectedPath,
    ...(sourcePath ? [sourcePath] : []),
    ...(maskPath ? [maskPath] : []),
  ];
  const inputDigests: Record<string, string> = {};
  await Promise.all(
    evidenceFiles.map(async (path) => {
      inputDigests[relative(root, path)] = await fileDigest(path);
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
    ...decision,
  });
}

const manifestArgument = argument("manifest");
if (!manifestArgument) {
  throw new Error("Usage: eval:batch-b --manifest=path [--out=path]");
}
const manifestPath = resolve(manifestArgument);
const root = dirname(manifestPath);
const manifest = parseManifest(await json<unknown>(manifestPath));
const samples = [];
for (const sample of manifest.samples) {
  samples.push(await evaluateSample(root, sample));
}
const report = {
  schemaVersion: "kanvas.image-atomic-batch-b-eval-report/v1",
  corpusId: manifest.corpusId,
  evidenceClass: manifest.evidenceClass,
  generatedAt: new Date().toISOString(),
  sampleCount: samples.length,
  passedCount: samples.filter(({ passed }) => passed).length,
  failedCount: samples.filter(({ passed }) => !passed).length,
  passed: samples.every(({ passed }) => passed),
  samples,
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
