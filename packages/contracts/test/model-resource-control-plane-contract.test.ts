import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  BrowserRuntimeManifestSchema,
  ModelResourceManifestSchema,
  ModelResourceImportSummarySchema,
  PublishModelResourceImportBodySchema,
  StartModelResourceImportBodySchema,
  downloadBrowserModelResourceRoute,
  cancelWorkspaceModelResourceImportRoute,
  getBrowserRuntimeManifestRoute,
  listWorkspaceModelResourcesRoute,
  startWorkspaceModelResourceImportRoute,
  getWorkspaceModelResourceImportRoute,
  uploadWorkspaceModelResourceImportRoute,
  publishWorkspaceModelResourceImportRoute,
  routeRegistry,
  setWorkspaceModelResourceStatusRoute,
} from "../src/api/index.js";

describe("Model Resource control-plane contracts", () => {
  it("registers model resource lifecycle routes independently from model services", () => {
    expect(listWorkspaceModelResourcesRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/model-resources",
    });
    expect(startWorkspaceModelResourceImportRoute.idempotency).toBe("required");
    expect(publishWorkspaceModelResourceImportRoute.idempotency).toBe(
      "required",
    );
    expect(cancelWorkspaceModelResourceImportRoute).toMatchObject({
      method: "POST",
      idempotency: "required",
    });
    expect(setWorkspaceModelResourceStatusRoute.method).toBe("PATCH");
    for (const route of [
      listWorkspaceModelResourcesRoute,
      startWorkspaceModelResourceImportRoute,
      getWorkspaceModelResourceImportRoute,
      uploadWorkspaceModelResourceImportRoute,
      publishWorkspaceModelResourceImportRoute,
      cancelWorkspaceModelResourceImportRoute,
      setWorkspaceModelResourceStatusRoute,
      getBrowserRuntimeManifestRoute,
      downloadBrowserModelResourceRoute,
    ]) {
      expect(routeRegistry).toContain(route);
    }
  });

  it("defines one bounded Browser runtime projection without storage identity", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
      BrowserRuntimeManifestSchema,
    );
    const capability = {
      capabilityKey: "image.background.remove",
      implementationRevisionId: "01K00000000000000000000012",
      implementationDigest: `sha256:${"d".repeat(64)}`,
      runtimeAdapterRevisionId: "01K00000000000000000000013",
      runtimeAdapterRevisionDigest: `sha256:${"f".repeat(64)}`,
      adapterKey: "first-party.image.background-remove.isnet.browser.v1",
      runtimeRole: "background_remove",
      runtimeProfileKind: "browser.u2net.v1",
      runtimeProfileVersion: 1,
      runtimeProfileSettings: {
        backend: "wasm",
        role: "background_remove",
      },
      implementationConfiguration: {},
      modelResource: {
        revisionId: "01K00000000000000000000011",
        revisionDigest: `sha256:${"b".repeat(64)}`,
        contentUrl:
          "/api/v1/model-resource-revisions/01K00000000000000000000011/content",
        contentDigest: `sha256:${"c".repeat(64)}`,
        format: "onnx",
        family: "isnet",
        variant: "isnet-general-fp16",
      },
      backend: "wasm",
      probeProfileVersion: 1,
      probeResultDigest: `sha256:${"e".repeat(64)}`,
    };
    expect(
      validate({
        schemaVersion: "kanvas.browser-runtime-manifest/v1",
        runtimeReleaseId: "01K00000000000000000000010",
        runtimeReleaseDigest: `sha256:${"a".repeat(64)}`,
        capabilities: [capability],
      }),
    ).toBe(true);
    expect(JSON.stringify(BrowserRuntimeManifestSchema)).not.toMatch(
      /storageProfileId|container|objectKey/u,
    );
  });

  it("keeps source provenance independent from the StorageProfile identity", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
      ModelResourceManifestSchema,
    );
    const manifest = {
      schemaVersion: "kanvas.model-resource/v1",
      family: "isnet",
      variant: "general-fp16",
      format: "onnx",
      executionTargets: ["browser", "worker"],
      sha256: `sha256:${"a".repeat(64)}`,
      byteSize: "1024",
      mediaType: "application/octet-stream",
      license: { spdxId: "MIT" },
      source: {
        kind: "hugging_face",
        repository: "imgly/isnet-general-onnx",
        revision: "440dea9095f704826361ef382869aa26773f7c2a",
        filePath: "onnx/model_fp16.onnx",
      },
      runtime: { inputSize: "1024" },
    };
    expect(validate(manifest)).toBe(true);
    expect(JSON.stringify(ModelResourceManifestSchema)).not.toMatch(
      /storageProfileId|container|objectKey/u,
    );
  });

  it("starts imports from a URL or upload without asking for storage or checksums", () => {
    const start = new Ajv2020({ strict: true, allErrors: true }).compile(
      StartModelResourceImportBodySchema,
    );
    expect(
      start({
        source: {
          kind: "url",
          url: "https://huggingface.co/onnx-community/model/resolve/main/model.onnx",
        },
      }),
    ).toBe(true);
    expect(JSON.stringify(StartModelResourceImportBodySchema)).not.toMatch(
      /sha256|storageProfile|bucket|objectKey/u,
    );

    const publish = new Ajv2020({ strict: true, allErrors: true }).compile(
      PublishModelResourceImportBodySchema,
    );
    expect(
      publish({
        expectedVersion: 2,
        target: { kind: "new", key: "example.image.encoder" },
        displayName: "Example image encoder",
        format: "onnx",
        license: { spdxId: "Apache-2.0" },
      }),
    ).toBe(true);
  });

  it("returns detected provenance and adapter candidates without storage identity", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    const validate = ajv.compile(ModelResourceImportSummarySchema);
    expect(
      validate({
        id: "01K00000000000000000000021",
        status: "ready",
        version: 3,
        downloadedBytes: "1024",
        source: {
          kind: "hugging_face",
          repository: "onnx-community/model",
          revision: "abc123",
          filePath: "model.onnx",
        },
        suggestedKey: "model.image.encoder",
        suggestedDisplayName: "Model image encoder",
        format: "onnx",
        files: [
          {
            path: "model.onnx",
            mediaType: "application/octet-stream",
            byteSize: "1024",
            sha256: `sha256:${"a".repeat(64)}`,
          },
        ],
        license: { spdxId: "Apache-2.0", confidence: "declared" },
        compatibleAdapters: [
          {
            adapterKey: "kanvas.onnx.image-encoder",
            displayName: {
              defaultLocale: "en-US",
              values: { "en-US": "ONNX image encoder" },
            },
            revision: 1,
            canonicalDigest: `sha256:${"b".repeat(64)}`,
            executionTarget: "browser",
            confidence: "exact",
            reasonCode: "model_resource.interface_matched",
          },
        ],
        requiredUserInputs: [],
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:01:00.000Z",
      }),
    ).toBe(true);
    expect(JSON.stringify(ModelResourceImportSummarySchema)).not.toMatch(
      /storageProfile|bucket|objectKey|secret/u,
    );
  });

  it("reports bounded download progress and a cancelled terminal state", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    const validate = ajv.compile(ModelResourceImportSummarySchema);
    const base = {
      id: "01K00000000000000000000021",
      version: 3,
      source: {
        kind: "https",
        url: "https://models.example/model.onnx",
      },
      expectedByteSize: "88152708",
      downloadedBytes: "5242880",
      files: [],
      compatibleAdapters: [],
      requiredUserInputs: [],
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:01:00.000Z",
    };

    expect(validate({ ...base, status: "fetching" })).toBe(true);
    expect(
      validate({
        ...base,
        status: "cancelled",
        cancelRequestedAt: "2026-08-31T00:00:30.000Z",
      }),
    ).toBe(true);
  });
});
