import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ModelResourceCatalogAssetV1 } from "@kanvas/contracts/capability";
import { digestProviderValue } from "@kanvas/database/runtime";
import { describe, expect, it } from "vitest";

import {
  analyzeModelResource,
  detectModelResourceFormat,
} from "../src/model-resource/model-resource-analyzer.js";

describe("model resource analyzer", () => {
  it("detects common formats without executing model bytes", () => {
    expect(detectModelResourceFormat("weights.onnx", new Uint8Array())).toBe(
      "onnx",
    );
    expect(detectModelResourceFormat("eng.traineddata", new Uint8Array())).toBe(
      "tesseract_data",
    );
    expect(
      detectModelResourceFormat(
        "weights.bin",
        new Uint8Array([0x47, 0x47, 0x55, 0x46]),
      ),
    ).toBe("gguf");
    expect(
      detectModelResourceFormat(
        "weights.bin",
        new Uint8Array([0, 0, 0, 0, 0x54, 0x46, 0x4c, 0x33]),
      ),
    ).toBe("tflite");
  });

  it("pins Hugging Face provenance without inferring compatibility from format", () => {
    const analysis = analyzeModelResource({
      originalSource: {
        kind: "https",
        url: "https://huggingface.co/acme/isnet/resolve/main/isnet.onnx",
      },
      file: {
        path: "isnet.onnx",
        storedObjectId: "01KTEST0000000000000000001",
        storageProfileId: "01KTEST0000000000000000002",
        container: "models",
        objectKey: "model",
        immutableIdentityHash: `sha256:${"a".repeat(64)}`,
        mediaType: "application/octet-stream",
        byteSize: "10",
        sha256: "b".repeat(64),
        sourceMetadata: {
          huggingFaceCommit: "1234567890abcdef",
          licenseSpdxId: "Apache-2.0",
          licenseUrl: "https://huggingface.co/acme/isnet",
        },
      },
      header: new Uint8Array(),
      adapters: [
        {
          adapterKey: "browser.onnx.v1",
          revision: 2,
          canonicalDigest: `sha256:${"c".repeat(64)}`,
          document: {
            schemaVersion: "kanvas.runtime-adapter-definition/v1",
            adapterKey: "browser.onnx.v1",
            revision: 2,
            displayName: {
              defaultLocale: "en-US",
              values: {
                "en-US": "ONNX Runtime",
                "zh-CN": "ONNX 运行器",
              },
            },
            executionTarget: "browser",
            sourceKinds: ["model_resource"],
            supportedModelFormats: ["onnx"],
            invocationInputSchema: { type: "object" },
            invocationOutputSchema: { type: "object" },
            configurationSchema: { type: "object" },
            artifactInputs: [],
            executable: {
              kind: "built_in",
              packageKey: "kanvas.onnx-runtime",
              packageVersion: "1.0.0",
              entrypoint: "onnx.run",
              releaseDigest: `sha256:${"d".repeat(64)}`,
            },
          },
        },
      ],
    });

    expect(analysis.source).toEqual({
      kind: "hugging_face",
      repository: "acme/isnet",
      revision: "1234567890abcdef",
      filePath: "isnet.onnx",
    });
    expect(analysis.format).toBe("onnx");
    expect(analysis.license?.spdxId).toBe("Apache-2.0");
    expect(analysis.compatibleAdapters).toEqual([]);
    expect(analysis.requiredUserInputs).toEqual([]);
  });

  it("matches an adapter only through the detected native interface", () => {
    const nativeInterface = {
      protocol: "tensor" as const,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["input"],
        properties: { input: { type: "array", items: { type: "number" } } },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["output"],
        properties: { output: { type: "array", items: { type: "number" } } },
      },
    };
    const analysis = analyzeModelResource({
      originalSource: { kind: "upload", fileName: "model.onnx" },
      file: {
        path: "model.onnx",
        storedObjectId: "01KTEST0000000000000000001",
        storageProfileId: "01KTEST0000000000000000002",
        container: "models",
        objectKey: "model",
        immutableIdentityHash: `sha256:${"a".repeat(64)}`,
        mediaType: "application/octet-stream",
        byteSize: "10",
        sha256: "b".repeat(64),
        sourceMetadata: {},
      },
      header: new Uint8Array(),
      detectedNativeInterface: nativeInterface,
      adapters: [
        {
          adapterKey: "browser.onnx.v1",
          revision: 1,
          canonicalDigest: `sha256:${"c".repeat(64)}`,
          document: {
            schemaVersion: "kanvas.runtime-adapter-definition/v1",
            adapterKey: "browser.onnx.v1",
            revision: 1,
            displayName: {
              defaultLocale: "en-US",
              values: { "en-US": "ONNX runtime" },
            },
            executionTarget: "browser",
            sourceKinds: ["model_resource"],
            supportedModelFormats: ["onnx"],
            modelResourceInterfaceDigest: digestProviderValue(nativeInterface),
            invocationInputSchema: { type: "object" },
            invocationOutputSchema: { type: "object" },
            configurationSchema: { type: "object" },
            artifactInputs: [],
            executable: {
              kind: "built_in",
              packageKey: "kanvas.onnx-runtime",
              packageVersion: "1.0.0",
              entrypoint: "onnx.run",
              releaseDigest: `sha256:${"d".repeat(64)}`,
            },
          },
        },
      ],
    });

    expect(analysis.nativeInterface).toEqual(nativeInterface);
    expect(analysis.compatibleAdapters).toEqual([
      expect.objectContaining({
        adapterKey: "browser.onnx.v1",
        reasonCode: "model_resource.interface_matched",
      }),
    ]);
  });

  it("keeps an unknown custom license without blocking import", () => {
    const analysis = analyzeModelResource({
      originalSource: {
        kind: "https",
        url: "https://models.example/encoder.onnx",
      },
      file: {
        path: "encoder.onnx",
        storedObjectId: "01KTEST0000000000000000001",
        storageProfileId: "01KTEST0000000000000000002",
        container: "models",
        objectKey: "model",
        immutableIdentityHash: `sha256:${"a".repeat(64)}`,
        mediaType: "application/octet-stream",
        byteSize: "10",
        sha256: "b".repeat(64),
        sourceMetadata: {},
      },
      header: new Uint8Array(),
      adapters: [],
    });

    expect(analysis.license).toEqual({
      spdxId: "NOASSERTION",
      confidence: "unknown",
    });
    expect(analysis.requiredUserInputs).toEqual([]);
  });

  it("accepts observed HTTP validators for a digest-pinned Catalog release", async () => {
    const catalog = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../catalog-packages/kanvas-default/model-resources/tesseract-tessdata-fast-eng.json",
        ),
        "utf8",
      ),
    ) as ModelResourceCatalogAssetV1;
    const analysis = analyzeModelResource({
      originalSource: {
        kind: "https",
        url: catalog.sourceUrl,
      },
      file: {
        path: "eng.traineddata",
        storedObjectId: "01KTEST0000000000000000001",
        storageProfileId: "01KTEST0000000000000000002",
        container: "models",
        objectKey: "model",
        immutableIdentityHash: `sha256:${"a".repeat(64)}`,
        mediaType: "application/octet-stream",
        byteSize: catalog.expectedByteSize ?? "4113088",
        sha256: catalog.expectedSha256.slice(7),
        sourceMetadata: {
          etag: '"observed-etag"',
          lastModified: "Mon, 31 Aug 2026 00:00:00 GMT",
        },
      },
      header: new Uint8Array(),
      adapters: [],
      catalogDocument: catalog,
    });

    expect(analysis.source).toEqual(catalog.source);
    expect(analysis.format).toBe("tesseract_data");
    expect(analysis.requiredUserInputs).toEqual([]);
  });
});
