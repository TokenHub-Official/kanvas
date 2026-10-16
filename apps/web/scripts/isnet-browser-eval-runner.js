import { env, InferenceSession, Tensor } from "onnxruntime-web";

const modelDigest =
  "sha256:2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20";
const implementationDigest =
  "sha256:8cb37f7485b19ad8470ad223ab54448ad75760841ece9ca62d2ebc4630470e68";
const directory = "browser-isnet-fp16";
const size = 1024;
const progress = document.querySelector("#progress");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const corpus = await (
  await fetch("/__kanvas_eval/corpus.json", {
    cache: "no-store",
  })
).json();

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function canvas(width, height) {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  return value;
}

function context(value) {
  const result = value.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!result) {
    throw new Error("IS-Net Eval requires Canvas 2D.");
  }
  return result;
}

function png(value) {
  return new Promise((resolvePng, rejectPng) => {
    value.toBlob((blob) => {
      if (blob) {
        resolvePng(blob);
      } else {
        rejectPng(new Error("IS-Net Eval PNG failed."));
      }
    }, "image/png");
  });
}

function input(image) {
  const target = canvas(size, size);
  const targetContext = context(target);
  targetContext.drawImage(image, 0, 0, size, size);
  const rgba = targetContext.getImageData(0, 0, size, size).data;
  const values = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      values[channel * plane + pixel] =
        (Number(rgba[pixel * 4 + channel]) - 128) / 256;
    }
  }
  return new Tensor("float32", values, [1, 3, size, size]);
}

async function maskBlob(image, raw) {
  const length = size * size;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    const value = Number(raw[index]);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range <= Number.EPSILON) {
    throw new Error("IS-Net Eval returned a degenerate mask.");
  }
  const pixels = new ImageData(size, size);
  for (let index = 0; index < length; index += 1) {
    const alpha = Math.round(((Number(raw[index]) - minimum) / range) * 255);
    pixels.data[index * 4] = alpha;
    pixels.data[index * 4 + 1] = alpha;
    pixels.data[index * 4 + 2] = alpha;
    pixels.data[index * 4 + 3] = 255;
  }
  const modelMask = canvas(size, size);
  context(modelMask).putImageData(pixels, 0, 0);
  const resized = canvas(image.width, image.height);
  const resizedContext = context(resized);
  resizedContext.imageSmoothingEnabled = true;
  resizedContext.imageSmoothingQuality = "high";
  resizedContext.drawImage(modelMask, 0, 0, image.width, image.height);
  return await png(resized);
}

status.textContent = "加载并校验 96MB FP16 模型";
env.wasm.wasmPaths = "/onnxruntime/";
const modelResponse = await fetch(
  "/__kanvas_eval/file/models/isnet-general-fp16.onnx",
  { cache: "force-cache" },
);
if (!modelResponse.ok) {
  throw new Error(
    `IS-Net model request failed with status ${modelResponse.status}.`,
  );
}
const model = await modelResponse.arrayBuffer();
if (
  hex(await crypto.subtle.digest("SHA-256", model)) !==
  modelDigest.slice("sha256:".length)
) {
  throw new Error("IS-Net model digest mismatch.");
}
const session = await InferenceSession.create(model, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});
const inputName = session.inputNames[0];
const outputName = session.outputNames[0];
const samples = [];
progress.max = corpus.samples.length;

for (const [index, sample] of corpus.samples.entries()) {
  status.textContent = `运行 ${index + 1}/${corpus.samples.length}: ${sample.id}`;
  const startedAt = performance.now();
  if (sample.categories.includes("unsupported_media")) {
    samples.push({
      id: sample.id,
      status: "failed",
      latencyMs: performance.now() - startedAt,
      failureCode: "browser.unsupported_media",
    });
  } else {
    try {
      const response = await fetch(
        `/__kanvas_eval/file/${encodeURIComponent(sample.sourceFile)}`,
        { cache: "no-store" },
      );
      const image = await createImageBitmap(await response.blob());
      try {
        const values = await session.run({
          [inputName]: input(image),
        });
        const tensor = values[outputName];
        if (
          !(tensor instanceof Tensor) ||
          tensor.type !== "float32" ||
          !(tensor.data instanceof Float32Array)
        ) {
          throw new Error("IS-Net Browser Eval output is not float32.");
        }
        const mask = await maskBlob(image, tensor.data);
        const persisted = await fetch(
          `/__kanvas_eval/candidate-mask/${directory}/${sample.id}`,
          {
            method: "POST",
            headers: {
              "content-type": "image/png",
            },
            body: mask,
          },
        );
        if (!persisted.ok) {
          throw new Error(
            `IS-Net mask persistence failed with status ${persisted.status}.`,
          );
        }
      } finally {
        image.close();
      }
      samples.push({
        id: sample.id,
        status: "succeeded",
        latencyMs: performance.now() - startedAt,
        ...(performance.memory?.usedJSHeapSize === undefined
          ? {}
          : {
              peakMemoryBytes: performance.memory.usedJSHeapSize,
            }),
        maskFile: `masks/${sample.id}.png`,
      });
    } catch (error) {
      samples.push({
        id: sample.id,
        status: "failed",
        latencyMs: performance.now() - startedAt,
        failureCode:
          error instanceof Error
            ? `browser.isnet.${error.name.toLowerCase()}`
            : "browser.isnet.unknown",
      });
    }
  }
  progress.value = index + 1;
  output.textContent = JSON.stringify(samples.at(-1), null, 2);
  await new Promise((resolveFrame) => {
    requestAnimationFrame(() => resolveFrame());
  });
}

const results = {
  schemaVersion: "kanvas.background-remove-eval-results/v1",
  target: "browser",
  implementationDigest,
  modelDigest,
  generatedAt: new Date().toISOString(),
  samples,
};
const persisted = await fetch(`/__kanvas_eval/candidate-results/${directory}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: `${JSON.stringify(results, null, 2)}\n`,
});
if (!persisted.ok) {
  throw new Error(
    `IS-Net results persistence failed with status ${persisted.status}.`,
  );
}
status.textContent = "完成";
output.textContent = JSON.stringify(results, null, 2);
document.title = "ATOM-01 IS-Net Browser Eval · 完成";
