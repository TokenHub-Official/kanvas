import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  allocateUserImportRoute,
  AllocateUserImportBodySchema,
  commitUserImportRoute,
  CommitUserImportBodySchema,
  downloadArtifactContentRoute,
  routeRegistry,
  uploadUserImportRoute,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("content transfer API contracts", () => {
  it("registers a bounded authenticated allocate, ingest, commit, and download protocol", () => {
    for (const route of [
      allocateUserImportRoute,
      uploadUserImportRoute,
      commitUserImportRoute,
      downloadArtifactContentRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }

    expect(allocateUserImportRoute.idempotency).toBe("required");
    expect(allocateUserImportRoute.request?.headers?.required).toEqual(
      expect.arrayContaining(["idempotency-key", "x-kanvas-workspace-id"]),
    );
    expect(uploadUserImportRoute.method).toBe("PUT");
    expect(uploadUserImportRoute.request?.rawBody).toEqual({
      contentTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      maximumBytes: 536_870_912,
    });
    expect(downloadArtifactContentRoute.responses).toHaveProperty("206");
    expect(
      downloadArtifactContentRoute.request?.headers?.properties,
    ).toHaveProperty("range");
  });

  it("rejects unbounded media types, classifications, and undeclared fields", () => {
    const ajv = createAjv();
    const allocate = ajv.compile(AllocateUserImportBodySchema);
    const commit = ajv.compile(CommitUserImportBodySchema);

    expect(
      allocate({
        expectedSize: "4096",
        expectedMediaType: "image/png",
        expectedSha256: "a".repeat(64),
      }),
    ).toBe(true);
    expect(
      allocate({
        expectedMediaType: "image/svg+xml",
      }),
    ).toBe(false);
    expect(
      allocate({
        expectedMediaType: "image/png",
        remoteUrl: "https://example.invalid/image.png",
      }),
    ).toBe(false);

    expect(
      commit({
        artifactType: "source-image",
        dataClassification: "restricted",
        displayFilename: "source.png",
        metadata: {
          source: "user_import",
        },
        asset: {
          name: "产品原图",
          assetType: "image.source",
        },
      }),
    ).toBe(true);
    expect(
      commit({
        artifactType: "source-image",
        dataClassification: "public",
      }),
    ).toBe(false);
    expect(
      commit({
        artifactType: "source-image",
        dataClassification: "internal",
        asset: {
          name: "产品原图",
          assetType: "image.source",
          executableHook: "run-me",
        },
      }),
    ).toBe(false);
  });
});
