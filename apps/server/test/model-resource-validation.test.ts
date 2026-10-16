import { describe, expect, it } from "vitest";

import {
  validateModelResourcePublication,
  verifyModelResourceStorage,
} from "../src/http/model-resource-validation.js";

const body = {
  key: "isnet.general.fp16",
  displayName: "ISNet General FP16",
  manifest: {
    schemaVersion: "kanvas.model-resource/v1" as const,
    family: "isnet",
    variant: "general-fp16",
    format: "onnx" as const,
    executionTargets: ["browser" as const],
    sha256: `sha256:${"a".repeat(64)}`,
    byteSize: "1024",
    mediaType: "application/octet-stream",
    license: { spdxId: "MIT" },
    source: {
      kind: "hugging_face" as const,
      repository: "imgly/isnet-general-onnx",
      revision: "440dea9095f704826361ef382869aa26773f7c2a",
      filePath: "onnx/model_fp16.onnx",
    },
    runtime: { inputSize: "1024" },
  },
};

describe("validateModelResourcePublication", () => {
  it("canonicalizes one immutable model resource release", () => {
    const result = validateModelResourcePublication(body);
    expect(result.revisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.manifest.executionTargets).toEqual(["browser"]);
  });

  it("rejects temporary signed URLs", () => {
    expect(() =>
      validateModelResourcePublication({
        ...body,
        manifest: {
          ...body.manifest,
          source: {
            kind: "https",
            url: "https://example.com/model?X-Amz-Signature=secret",
          },
        },
      }),
    ).toThrow("temporary signatures");
  });

  it("verifies storage independently without adding its identity to the manifest", async () => {
    const storedFile = {
      storageProfileId: "models-s3",
      container: "models",
      objectKey: "isnet/model.onnx",
      byteSize: "1024",
      sha256: "a".repeat(64),
      immutableIdentityHash: `sha256:${"b".repeat(64)}`,
    };
    const verified = await verifyModelResourceStorage(body, storedFile, {
      resolve: () => ({
        storageProfileId: "models-s3",
        kind: "s3",
        adapter: {
          inspectObject: () =>
            Promise.resolve({
              identity: {
                storageProfileId: "models-s3",
                container: "models",
                objectKey: "isnet/model.onnx",
              },
              byteSize: "1024",
              sha256: "a".repeat(64),
              immutableIdentityHash: `sha256:${"b".repeat(64)}`,
            }),
        } as never,
      }),
    });
    expect(verified.manifest.source).toEqual(body.manifest.source);
    expect(JSON.stringify(verified.manifest)).not.toMatch(
      /models-s3|objectKey|immutableIdentityHash/u,
    );
  });
});
