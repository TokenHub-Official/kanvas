import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

const analysisSize = 1024;
const minimumAreaRatio = 0.001;
const threshold = 89;
const repositoryRoot = resolve(import.meta.dirname, "../../..");

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  return value ? resolve(value) : resolve(repositoryRoot, fallback);
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function mask(path) {
  const { data, info } = await sharp(path)
    .greyscale()
    .resize(analysisSize, analysisSize, {
      fit: "fill",
      kernel: "cubic",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== analysisSize ||
    info.height !== analysisSize ||
    info.channels !== 1
  ) {
    throw new Error(`Mask ${path} decoded inconsistently.`);
  }
  return data;
}

function components(pixels) {
  const pixelCount = analysisSize * analysisSize;
  const minimumArea = Math.ceil(minimumAreaRatio * pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const found = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] === 1 || pixels[start] < threshold) {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let area = 0;
    let sum = 0;
    let minimumX = analysisSize;
    let minimumY = analysisSize;
    let maximumX = 0;
    let maximumY = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % analysisSize;
      const y = Math.floor(index / analysisSize);
      area += 1;
      sum += pixels[index];
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < analysisSize ? index + 1 : -1,
        y > 0 ? index - analysisSize : -1,
        y + 1 < analysisSize ? index + analysisSize : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          visited[neighbor] === 0 &&
          pixels[neighbor] >= threshold
        ) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    if (area >= minimumArea) {
      found.push({
        area,
        confidence: sum / area / 255,
        x: minimumX / analysisSize,
        y: minimumY / analysisSize,
        width: (maximumX + 1 - minimumX) / analysisSize,
        height: (maximumY + 1 - minimumY) / analysisSize,
      });
    }
  }
  return found.sort(
    (left, right) =>
      right.area - left.area ||
      right.confidence - left.confidence ||
      left.y - right.y ||
      left.x - right.x,
  );
}

function boundsIou(left, right) {
  if (!left || !right) {
    return 0;
  }
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union =
    left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function maskIou(left, right) {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] >= threshold;
    const b = right[index] >= threshold;
    if (a && b) {
      intersection += 1;
    }
    if (a || b) {
      union += 1;
    }
  }
  return union > 0 ? intersection / union : 1;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

const corpusPath = argument(
  "corpus",
  "eval-data/background-remove/corpus.json",
);
const browserResultsPath = argument(
  "browser-results",
  "eval-data/background-remove/browser-isnet-fp16/results.json",
);
const workerResultsPath = argument(
  "worker-results",
  "eval-data/background-remove/worker-isnet/results.json",
);
const outputPath = argument("out", "eval-data/subject-detect/report.json");
const [corpus, browserResults, workerResults] = await Promise.all([
  json(corpusPath),
  json(browserResultsPath),
  json(workerResultsPath),
]);
const browserById = new Map(
  browserResults.samples.map((sample) => [sample.id, sample]),
);
const workerById = new Map(
  workerResults.samples.map((sample) => [sample.id, sample]),
);
const samples = [];
for (const sample of corpus.samples) {
  const browser = browserById.get(sample.id);
  const worker = workerById.get(sample.id);
  if (
    !sample.groundTruthMaskFile ||
    browser?.status !== "succeeded" ||
    worker?.status !== "succeeded" ||
    !browser.maskFile ||
    !worker.maskFile
  ) {
    samples.push({
      id: sample.id,
      categories: sample.categories,
      designerDecision: sample.annotation.decision,
      status: "not_evaluated",
    });
    continue;
  }
  const [truthMask, browserMask, workerMask] = await Promise.all([
    mask(resolve(dirname(corpusPath), sample.groundTruthMaskFile)),
    mask(resolve(dirname(browserResultsPath), browser.maskFile)),
    mask(resolve(dirname(workerResultsPath), worker.maskFile)),
  ]);
  const truth = components(truthMask);
  const browserCandidates = components(browserMask);
  const workerCandidates = components(workerMask);
  samples.push({
    id: sample.id,
    categories: sample.categories,
    designerDecision: sample.annotation.decision,
    status: "evaluated",
    groundTruthCandidateCount: truth.length,
    browserCandidateCount: browserCandidates.length,
    workerCandidateCount: workerCandidates.length,
    browserGroundTruthPrimaryBoundsIou: rounded(
      boundsIou(browserCandidates[0], truth[0]),
    ),
    workerGroundTruthPrimaryBoundsIou: rounded(
      boundsIou(workerCandidates[0], truth[0]),
    ),
    browserWorkerPrimaryBoundsIou: rounded(
      boundsIou(browserCandidates[0], workerCandidates[0]),
    ),
    browserWorkerConfidenceDrift: rounded(
      Math.abs(
        (browserCandidates[0]?.confidence ?? 0) -
          (workerCandidates[0]?.confidence ?? 0),
      ),
    ),
    browserMaskIou: rounded(maskIou(browserMask, truthMask)),
    workerMaskIou: rounded(maskIou(workerMask, truthMask)),
  });
}
const evaluated = samples.filter((sample) => sample.status === "evaluated");
const releaseGateSamples = evaluated.filter(
  (sample) => sample.designerDecision !== "fail_or_fallback",
);
const categories = new Set(
  releaseGateSamples.flatMap((sample) => sample.categories),
);
function metricsFor(values) {
  return {
    evaluatedCount: values.length,
    meanBrowserGroundTruthPrimaryBoundsIou: rounded(
      mean(values.map((sample) => sample.browserGroundTruthPrimaryBoundsIou)),
    ),
    meanWorkerGroundTruthPrimaryBoundsIou: rounded(
      mean(values.map((sample) => sample.workerGroundTruthPrimaryBoundsIou)),
    ),
    meanBrowserWorkerPrimaryBoundsIou: rounded(
      mean(values.map((sample) => sample.browserWorkerPrimaryBoundsIou)),
    ),
    maximumBrowserWorkerConfidenceDrift: rounded(
      Math.max(
        0,
        ...values.map((sample) => sample.browserWorkerConfidenceDrift),
      ),
    ),
    meanBrowserMaskIou: rounded(
      mean(values.map((sample) => sample.browserMaskIou)),
    ),
    meanWorkerMaskIou: rounded(
      mean(values.map((sample) => sample.workerMaskIou)),
    ),
  };
}
const metrics = {
  allEvaluated: metricsFor(evaluated),
  releaseGate: metricsFor(releaseGateSamples),
  knownFailOrFallbackCount: evaluated.length - releaseGateSamples.length,
};
const requiredCategories = [
  "product",
  "person",
  "multiple_subjects",
  "small_subject",
  "complex_background",
];
const failures = [
  ...(metrics.releaseGate.evaluatedCount < 25
    ? ["At least 25 real samples must be evaluated."]
    : []),
  ...(metrics.releaseGate.meanBrowserGroundTruthPrimaryBoundsIou < 0.85
    ? ["Browser primary bounds mean IoU is below 0.85."]
    : []),
  ...(metrics.releaseGate.meanWorkerGroundTruthPrimaryBoundsIou < 0.85
    ? ["Worker primary bounds mean IoU is below 0.85."]
    : []),
  ...(metrics.releaseGate.meanBrowserWorkerPrimaryBoundsIou < 0.9
    ? ["Browser/Worker primary bounds mean IoU is below 0.90."]
    : []),
  ...(metrics.releaseGate.maximumBrowserWorkerConfidenceDrift > 0.08
    ? ["Browser/Worker confidence drift exceeds 0.08."]
    : []),
  ...requiredCategories
    .filter((category) => !categories.has(category))
    .map((category) => `Eval category ${category} is missing.`),
];
const report = {
  schemaVersion: "kanvas.subject-detect-eval-report/v1",
  generatedAt: new Date().toISOString(),
  corpusId: corpus.corpusId,
  semantics: {
    category: "visual_subject",
    taxonomy: "class_agnostic_isnet",
    analysisSize,
    minimumAreaRatio,
    minimumConfidence: threshold / 255,
  },
  sources: {
    browserImplementationDigest:
      "sha256:9775a2fb93b02c88ae3931bf7a21a025df0eec401463d645fa8767f544032718",
    workerImplementationDigest:
      "sha256:9dd2f2c1a523eb59d3d995f7587e2d5f4093fd84b23c0b137518ebd0123783e2",
    browserMaskResults: browserResultsPath,
    workerMaskResults: workerResultsPath,
    groundTruthCorpus: corpusPath,
  },
  metrics,
  acceptance: {
    status: failures.length === 0 ? "passed" : "failed",
    thresholds: {
      minimumEvaluatedSamples: 25,
      minimumMeanGroundTruthPrimaryBoundsIou: 0.85,
      minimumMeanBrowserWorkerPrimaryBoundsIou: 0.9,
      maximumBrowserWorkerConfidenceDrift: 0.08,
      requiredCategories,
    },
    failures,
  },
  samples,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report.metrics, null, 2)}\n`);
if (failures.length > 0) {
  process.exitCode = 2;
}
