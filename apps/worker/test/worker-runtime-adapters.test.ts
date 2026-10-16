import { describe, expect, it } from "vitest";

import { deterministicImageDerivedPngAdapterKey } from "../src/adapter/nonproduction-deterministic-image-adapter.js";
import { createWorkerRuntimeAdapterRegistry } from "../src/adapter/worker-runtime-adapters.js";
import {
  u2netBackgroundRemoveAdapterKey,
  u2netBackgroundRemoveWebpAdapterKey,
} from "../src/adapter/u2net-background-remove-adapter.js";
import { u2netSubjectDetectAdapterKey } from "../src/adapter/u2net-subject-detect-adapter.js";
import { sharpImageResizeAdapterKey } from "../src/adapter/image-upscale-adapter.js";
import { faithfulImageDenoiseAdapterKey } from "../src/adapter/image-denoise-adapter.js";
import { imageLightEnhanceAdapterKey } from "../src/adapter/image-light-enhance-adapter.js";
import {
  imageCropSuggestAdapterKey,
  imageQualityAssessAdapterKey,
} from "../src/adapter/batch-c-image-analysis-adapters.js";
import { imageBackgroundComposeAdapterKey } from "../src/adapter/image-background-compose-adapter.js";
import { tesseractTextExtractAdapterKey } from "../src/adapter/tesseract-text-extract-adapter.js";

const unavailableInputs = Object.freeze({
  open() {
    return Promise.reject(new Error("Input Artifact access is unavailable."));
  },
});

const context = Object.freeze({
  workspaceId: "01K00000000000000000000001",
  workflowRunId: "01K00000000000000000000002",
  nodeRunId: "01K00000000000000000000003",
  capabilityRunId: "01K00000000000000000000004",
  attemptId: "01K00000000000000000000005",
  inputArtifacts: unavailableInputs,
});

function contextFor(adapterKey: string) {
  return Object.freeze({
    ...context,
    runtimeAdapter: {
      schemaVersion: "kanvas.runtime-adapter-definition/v1" as const,
      adapterKey,
      revision: 1,
      displayName: {
        defaultLocale: "en-US",
        values: { "zh-CN": adapterKey, "en-US": adapterKey },
      },
      executionTarget: "worker" as const,
      sourceKinds: ["plugin" as const],
      supportedModelFormats: [],
      invocationInputSchema: {},
      invocationOutputSchema: {},
      configurationSchema: {},
      artifactInputs: [],
      executable: {
        kind: "built_in" as const,
        packageKey: "test.worker-runtime",
        packageVersion: "1",
        entrypoint: adapterKey,
        releaseDigest: `sha256:${"a".repeat(64)}`,
      },
    },
  });
}

const batchCWorkerAdapterKeys = Object.freeze([
  imageBackgroundComposeAdapterKey,
  imageCropSuggestAdapterKey,
  imageQualityAssessAdapterKey,
]);

describe("Worker runtime Adapter registry", () => {
  it("keeps the deterministic image Adapter disabled by default", async () => {
    const registry = createWorkerRuntimeAdapterRegistry({
      deterministicImageAdapterEnabled: false,
    });

    expect(registry.keys).toEqual(
      [
        "demo.echo.worker",
        faithfulImageDenoiseAdapterKey,
        imageLightEnhanceAdapterKey,
        sharpImageResizeAdapterKey,
        u2netBackgroundRemoveAdapterKey,
        u2netBackgroundRemoveWebpAdapterKey,
        u2netSubjectDetectAdapterKey,
        tesseractTextExtractAdapterKey,
        ...batchCWorkerAdapterKeys,
      ].sort(),
    );
    await expect(
      registry.execute(
        deterministicImageDerivedPngAdapterKey,
        {},
        new AbortController().signal,
        context,
      ),
    ).rejects.toThrow(/Unsupported worker capability adapter/u);
  });

  it("registers the deterministic image Adapter only when explicitly enabled", async () => {
    const registry = createWorkerRuntimeAdapterRegistry({
      deterministicImageAdapterEnabled: true,
    });

    expect(registry.keys).toEqual(
      [
        "demo.echo.worker",
        faithfulImageDenoiseAdapterKey,
        imageLightEnhanceAdapterKey,
        sharpImageResizeAdapterKey,
        deterministicImageDerivedPngAdapterKey,
        u2netBackgroundRemoveAdapterKey,
        u2netBackgroundRemoveWebpAdapterKey,
        u2netSubjectDetectAdapterKey,
        tesseractTextExtractAdapterKey,
        ...batchCWorkerAdapterKeys,
      ].sort(),
    );
    await expect(
      registry.execute(
        "demo.echo.worker",
        { message: "ready" },
        new AbortController().signal,
        contextFor("demo.echo.worker"),
      ),
    ).resolves.toEqual({
      protocol: "kanvas.worker-adapter-result/v1",
      capabilityOutput: {
        message: "ready",
      },
      outputs: [],
    });
  });

  it("registers model-resource adapters without loading model bytes eagerly", () => {
    const registry = createWorkerRuntimeAdapterRegistry({
      deterministicImageAdapterEnabled: false,
    });

    expect(registry.keys).toEqual(
      [
        "demo.echo.worker",
        u2netBackgroundRemoveAdapterKey,
        u2netBackgroundRemoveWebpAdapterKey,
        u2netSubjectDetectAdapterKey,
        tesseractTextExtractAdapterKey,
        faithfulImageDenoiseAdapterKey,
        imageLightEnhanceAdapterKey,
        sharpImageResizeAdapterKey,
        ...batchCWorkerAdapterKeys,
      ].sort(),
    );
  });
});
