import { createHash } from "node:crypto";

import type { ModelResourceManifest } from "@kanvas/contracts/api";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  createTesseractTextExtractAdapter,
  tesseractModelConfiguration,
} from "../src/adapter/tesseract-text-extract-adapter.js";
import type { TesseractRecognizer } from "../src/adapter/tesseract-text-extract-adapter.js";
import type {
  WorkerAdapterExecutionContext,
  WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";

const sourceArtifactId = "01K0000000000000000000003A";
const modelSha256 =
  "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";
const modelBytes = Uint8Array.from([1, 2, 3, 4]);

const modelManifest: ModelResourceManifest = {
  schemaVersion: "kanvas.model-resource/v1",
  family: "tesseract",
  variant: "tessdata-fast-eng",
  format: "tesseract_data",
  executionTargets: ["worker"],
  sha256: `sha256:${modelSha256}`,
  byteSize: "4113088",
  mediaType: "application/octet-stream",
  license: {
    spdxId: "Apache-2.0",
    sourceUrl: "https://github.com/tesseract-ocr/tessdata_fast",
  },
  source: {
    kind: "https",
    url: "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/revision/eng.traineddata",
  },
  nativeInterface: {
    protocol: "structured" as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  },
  runtime: {},
};

const implementationConfiguration = Object.freeze({
  model: {
    family: "tesseract",
    variant: "tessdata-fast-eng",
    languageTag: "en",
    modelCode: "eng",
    sha256: modelSha256,
    license: "Apache-2.0",
  },
  engineVersion: "7.0.0",
  maximumSourceBytes: 67_108_864,
  maximumSourcePixels: 32_000_000,
});

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 4,
      height: 3,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function context(bytes: Buffer): WorkerAdapterExecutionContext {
  return {
    workspaceId: "01K00000000000000000000000",
    workflowRunId: "01K00000000000000000000001",
    nodeRunId: "01K00000000000000000000002",
    capabilityRunId: "01K00000000000000000000003",
    attemptId: "01K00000000000000000000004",
    implementationConfiguration,
    inputArtifacts: {
      async open({ inputPointer }) {
        await Promise.resolve();
        expect(inputPointer).toBe("/sourceArtifactId");
        return {
          artifactId: sourceArtifactId,
          storedObjectId: "01K00000000000000000000005",
          artifactType: "image",
          dataClassification: "internal",
          byteSize: String(bytes.byteLength),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          mediaType: "image/png",
          body: (async function* () {
            await Promise.resolve();
            yield bytes;
          })(),
        };
      },
    },
    modelResource: {
      revisionId: "01K00000000000000000000006",
      revisionDigest: `sha256:${"b".repeat(64)}`,
      manifest: modelManifest,
      read: () => Promise.resolve(Uint8Array.from(modelBytes)),
    },
  };
}

describe("Tesseract text-extract Worker Adapter", () => {
  it("uses the pinned ModelResource bytes without a runtime download", async () => {
    const recognize = vi.fn<TesseractRecognizer>(
      async ({ modelCode, image, modelBytes: model }) => {
        expect(modelCode).toBe("eng");
        expect(model).toEqual(modelBytes);
        await expect(sharp(image).metadata()).resolves.toMatchObject({
          width: 4,
          height: 3,
          format: "png",
        });
        return {
          text: "Hello\n",
          confidence: 88,
          blocks: [
            {
              paragraphs: [
                {
                  is_ltr: true,
                  lines: [
                    {
                      text: "Hello",
                      confidence: 90,
                      bbox: { x0: 1, y0: 1, x1: 3, y1: 2 },
                      words: [],
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
    );
    const adapter = createTesseractTextExtractAdapter({ recognize });
    const result = (await adapter.execute(
      {
        sourceArtifactId,
        languages: ["en"],
        granularity: "line",
        minimumConfidence: 0.5,
      },
      new AbortController().signal,
      context(await sourcePng()),
    )) as WorkerAdapterExecutionResult;

    expect(recognize).toHaveBeenCalledOnce();
    expect(result.outputs).toEqual([]);
    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-text-extract-result/v1",
      sourceArtifactId,
      sourceWidth: 4,
      sourceHeight: 3,
      text: "Hello",
      language: "en",
      direction: "ltr",
      confidence: 0.88,
      blocks: [
        {
          level: "line",
          text: "Hello",
          confidence: 0.9,
        },
      ],
      qualitySignals: {
        method: "tesseract_wasm_lstm",
        generative: false,
        lowConfidence: false,
      },
    });
  });

  it("advances fallback when the requested language has no pinned resource", async () => {
    const recognize = vi.fn();
    const adapter = createTesseractTextExtractAdapter({ recognize });
    await expect(
      adapter.execute(
        {
          sourceArtifactId,
          languages: ["zh-CN"],
          granularity: "line",
          minimumConfidence: 0.5,
        },
        new AbortController().signal,
        context(await sourcePng()),
      ),
    ).rejects.toMatchObject({
      stableErrorCode: "model_resource.language_not_supported",
    });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("rejects a ModelResource whose digest differs from the implementation", async () => {
    const invalid = context(await sourcePng());
    expect(() =>
      tesseractModelConfiguration({
        ...invalid,
        modelResource: {
          ...invalid.modelResource!,
          manifest: {
            ...modelManifest,
            sha256: `sha256:${"f".repeat(64)}`,
          },
        },
      }),
    ).toThrow("incompatible with this Tesseract Runtime Adapter revision");
  });
});
