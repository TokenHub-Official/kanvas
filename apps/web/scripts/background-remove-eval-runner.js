import { createDirectBrowserU2NetBackgroundRemover } from "/src/features/browser-executor/u2net-browser-background-remove.ts";

const browserImplementationDigest =
  "sha256:a2f2c4b61111c4daa94be708e0819874ab2f62ab6ddc0658b51d9bd176e93d5d";
const modelDigest =
  "sha256:309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";
const progress = document.querySelector("#progress");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const corpus = await (
  await fetch("/__kanvas_eval/corpus.json", {
    cache: "no-store",
  })
).json();
const remover = createDirectBrowserU2NetBackgroundRemover({
  inputSize: 320,
  modelDigest,
  modelUrl: "/models/u2netp.onnx",
  modelVariant: "u2netp",
  normalization: "imagenet",
  wasmPaths: "/onnxruntime/",
});
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
      const sourceResponse = await fetch(
        `/__kanvas_eval/file/${encodeURIComponent(sample.sourceFile)}`,
        { cache: "no-store" },
      );
      if (!sourceResponse.ok) {
        throw new Error(
          `Source request failed with status ${sourceResponse.status}.`,
        );
      }
      const result = await remover.execute(
        await sourceResponse.blob(),
        {
          refinement: "fine",
          sourceArtifactId: "01K00000000000000000000000",
        },
        new AbortController().signal,
      );
      const maskResponse = await fetch(
        `/__kanvas_eval/browser-mask/${sample.id}`,
        {
          method: "POST",
          headers: {
            "content-type": "image/png",
          },
          body: result.mask,
        },
      );
      if (!maskResponse.ok) {
        throw new Error(
          `Mask persistence failed with status ${maskResponse.status}.`,
        );
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
            ? `browser.eval.${error.name.toLowerCase()}`
            : "browser.eval.unknown",
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
  implementationDigest: browserImplementationDigest,
  modelDigest,
  generatedAt: new Date().toISOString(),
  samples,
};
const persisted = await fetch("/__kanvas_eval/browser-results", {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: `${JSON.stringify(results, null, 2)}\n`,
});
if (!persisted.ok) {
  throw new Error(
    `Results persistence failed with status ${persisted.status}.`,
  );
}
status.textContent = "完成";
output.textContent = JSON.stringify(results, null, 2);
document.title = "ATOM-01 Browser Eval · 完成";
