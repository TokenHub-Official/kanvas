import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { InferenceSession, Tensor } from "onnxruntime-node";
import sharp from "sharp";

const root = resolve(
  import.meta.dirname,
  "../../../eval-data/background-remove",
);
const argumentsMap = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator < 0
      ? [argument, ""]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const modelPath = argumentsMap.has("--model")
  ? resolve(argumentsMap.get("--model"))
  : resolve(import.meta.dirname, "../../../apps/web/public/models/u2netp.onnx");
const outputDirectory = argumentsMap.get("--out-directory") ?? "worker";
const releaseImplementationDigest =
  "sha256:f273333f6048693f671880353d9438f330438a833fa722cd5e8472bb248c1584";
const releaseModelDigest =
  "sha256:309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";
const inputSize = Number(argumentsMap.get("--input-size") ?? "320");
if (!Number.isSafeInteger(inputSize) || inputSize < 64 || inputSize > 2_048) {
  throw new TypeError("Worker Eval input size is invalid.");
}
const normalization = argumentsMap.get("--normalization") ?? "u2net";
if (!["u2net", "isnet"].includes(normalization)) {
  throw new TypeError("Worker Eval normalization is invalid.");
}
const corpus = JSON.parse(await readFile(resolve(root, "corpus.json"), "utf8"));
const modelBytes = await readFile(modelPath);
const observedModelDigest = `sha256:${createHash("sha256")
  .update(modelBytes)
  .digest("hex")}`;
const experimental = argumentsMap.has("--model");
if (!experimental && observedModelDigest !== releaseModelDigest) {
  throw new Error("Worker Eval model digest does not match the release.");
}
const implementationDigest = experimental
  ? `sha256:${createHash("sha256")
      .update(
        `kanvas.background-remove.worker-candidate:${observedModelDigest}`,
      )
      .digest("hex")}`
  : releaseImplementationDigest;
const session = await InferenceSession.create(modelBytes, {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
});
const inputName = session.inputNames[0];
const outputName = session.outputNames[0];
if (!inputName || !outputName) {
  throw new Error("Worker Eval model has no usable tensors.");
}
const maskRoot = resolve(root, outputDirectory, "masks");
await mkdir(maskRoot, { recursive: true });
const samples = [];

function normalizedMask(raw) {
  const length = inputSize * inputSize;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    const value = Number(raw[index]);
    if (!Number.isFinite(value)) {
      throw new Error("Worker Eval model produced non-finite data.");
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  if (range <= Number.EPSILON) {
    throw new Error("Worker Eval model produced a degenerate mask.");
  }
  return Uint8Array.from({ length }, (_, index) =>
    Math.round(((Number(raw[index]) - minimum) / range) * 255),
  );
}

async function inputTensor(source) {
  const { data, info } = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .removeAlpha()
    .resize(inputSize, inputSize, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== inputSize ||
    info.height !== inputSize ||
    info.channels !== 3
  ) {
    throw new Error("Worker Eval input preparation failed.");
  }
  const values = new Float32Array(3 * inputSize * inputSize);
  const means =
    normalization === "isnet" ? [128, 128, 128] : [0.485, 0.456, 0.406];
  const deviations =
    normalization === "isnet" ? [256, 256, 256] : [0.229, 0.224, 0.225];
  const plane = inputSize * inputSize;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const channelValue = Number(data[pixel * 3 + channel]);
      values[channel * plane + pixel] =
        normalization === "isnet"
          ? (channelValue - means[channel]) / deviations[channel]
          : (channelValue / 255 - means[channel]) / deviations[channel];
    }
  }
  return new Tensor("float32", values, [1, 3, inputSize, inputSize]);
}

for (const [index, sample] of corpus.samples.entries()) {
  const startedAt = performance.now();
  if (sample.categories.includes("unsupported_media")) {
    samples.push({
      id: sample.id,
      status: "failed",
      latencyMs: performance.now() - startedAt,
      peakMemoryBytes: process.memoryUsage().rss,
      failureCode: "worker.unsupported_media",
    });
  } else {
    try {
      const source = await readFile(resolve(root, sample.sourceFile));
      const metadata = await sharp(source, {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("Worker Eval source dimensions are missing.");
      }
      const output = await session.run({
        [inputName]: await inputTensor(source),
      });
      const tensor = output[outputName];
      if (
        !(tensor instanceof Tensor) ||
        tensor.type !== "float32" ||
        !(tensor.data instanceof Float32Array)
      ) {
        throw new Error("Worker Eval output must be float32.");
      }
      const path = resolve(maskRoot, `${sample.id}.png`);
      await sharp(normalizedMask(tensor.data), {
        raw: {
          width: inputSize,
          height: inputSize,
          channels: 1,
        },
      })
        .resize(metadata.width, metadata.height, {
          fit: "fill",
          kernel: "lanczos3",
        })
        .blur(0.45)
        .png()
        .toFile(path);
      samples.push({
        id: sample.id,
        status: "succeeded",
        latencyMs: performance.now() - startedAt,
        peakMemoryBytes: process.memoryUsage().rss,
        maskFile: `masks/${sample.id}.png`,
      });
    } catch (error) {
      samples.push({
        id: sample.id,
        status: "failed",
        latencyMs: performance.now() - startedAt,
        peakMemoryBytes: process.memoryUsage().rss,
        failureCode:
          error instanceof Error
            ? `worker.eval.${error.name.toLowerCase()}`
            : "worker.eval.unknown",
      });
    }
  }
  process.stdout.write(
    `${String(index + 1).padStart(2, "0")}/${corpus.samples.length} ${sample.id} ${samples.at(-1).status}\n`,
  );
}

const results = {
  schemaVersion: "kanvas.background-remove-eval-results/v1",
  target: "worker",
  implementationDigest,
  modelDigest: observedModelDigest,
  generatedAt: new Date().toISOString(),
  samples,
};
await writeFile(
  resolve(root, outputDirectory, "results.json"),
  `${JSON.stringify(results, null, 2)}\n`,
);
