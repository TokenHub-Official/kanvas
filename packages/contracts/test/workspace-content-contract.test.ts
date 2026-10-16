import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceAssetFromArtifactRoute,
  CreateWorkspaceAssetFromArtifactBodySchema,
  getWorkspaceAssetRoute,
  getArtifactPreviewRoute,
  listWorkspaceAssetsRoute,
  listWorkspaceCreationEntrypointsRoute,
  routeRegistry,
  WorkspaceAssetListSchema,
  WorkspaceAssetListQuerySchema,
  WorkspaceAssetAdoptionSchema,
  WorkspaceCreationEntrypointListSchema,
  WorkspaceAssetDetailSchema,
  WorkspaceAssetDetailQuerySchema,
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

describe("Workspace content query contracts", () => {
  it("registers replay-safe result Artifact adoption as an authorized mutation", () => {
    expect(createWorkspaceAssetFromArtifactRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/assets",
      security: ["sessionOrServiceToken"],
      idempotency: "required",
    });
    expect(routeRegistry).toContain(createWorkspaceAssetFromArtifactRoute);
    const body = createAjv().compile(
      CreateWorkspaceAssetFromArtifactBodySchema,
    );
    const response = createAjv().compile(WorkspaceAssetAdoptionSchema);
    expect(
      body({
        assetId: "01K00000000000000000000004",
        artifactId: "01K00000000000000000000005",
        name: "去背景结果",
      }),
    ).toBe(true);
    expect(
      response({
        status: "created",
        assetId: "01K00000000000000000000004",
        artifactId: "01K00000000000000000000005",
        version: 1,
      }),
    ).toBe(true);
  });

  it("registers authorized Asset reads", () => {
    for (const route of [
      listWorkspaceAssetsRoute,
      getWorkspaceAssetRoute,
      getArtifactPreviewRoute,
    ]) {
      expect(route).toMatchObject({
        method: "GET",
        security: ["sessionOrServiceToken"],
        idempotency: "none",
      });
      expect(routeRegistry).toContain(route);
    }
  });

  it("returns an explicit effective invocation schema for creation entrypoints", () => {
    expect(listWorkspaceCreationEntrypointsRoute).toMatchObject({
      method: "GET",
      security: ["sessionOrServiceToken"],
      idempotency: "none",
    });
    const validate = createAjv().compile(WorkspaceCreationEntrypointListSchema);
    expect(
      validate({
        items: [
          {
            skillRevisionId: "01K00000000000000000000001",
            skillKey: "first-party.image-edit",
            skillRevision: 1,
            entrypointKey: "edit",
            workflowRevisionId: "01K00000000000000000000002",
            workflowRevision: 1,
            displayName: "Edit image",
            nonProduction: false,
            outputPresentation: "board",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            capability: {
              contractKey: "image.edit",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
              surfaces: ["workflow", "agent", "canvas"],
              parameters: [
                { key: "sourceArtifactId", semanticType: "artifact.image" },
              ],
              outputs: [
                {
                  key: "imageArtifactId",
                  semanticType: "artifact.image",
                  primary: true,
                },
              ],
            },
            effectiveInvocationSchema: {
              schemaVersion: "kanvas.effective-invocation-schema/v1",
              availability: "available",
              controlledParameterKeys: ["quality", "seed"],
              validationSchema: {
                schemaVersion:
                  "kanvas.effective-invocation-validation-schema/v1",
                document: '{"type":"object"}',
              },
              fields: [
                {
                  key: "prompt",
                  label: "Prompt",
                  required: true,
                  valueType: "string",
                  maxLength: 8_000,
                },
                {
                  key: "seed",
                  label: "Seed",
                  required: false,
                  valueType: "integer",
                  minimum: 0,
                  maximum: 4_294_967_295,
                },
              ],
            },
          },
          {
            skillRevisionId: "01K00000000000000000000003",
            skillKey: "team.unavailable",
            skillRevision: 1,
            entrypointKey: "run",
            workflowRevisionId: "01K00000000000000000000004",
            workflowRevision: 1,
            displayName: "Unavailable",
            nonProduction: false,
            outputPresentation: "single_review",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            effectiveInvocationSchema: {
              schemaVersion: "kanvas.effective-invocation-schema/v1",
              availability: "unavailable",
              reason: "route_unavailable",
              controlledParameterKeys: [],
            },
          },
        ],
        truncated: false,
      }),
    ).toBe(true);
  });

  it("bounds Asset detail history pagination by kind and opaque cursor", () => {
    const validate = createAjv().compile(WorkspaceAssetDetailQuerySchema);
    expect(
      validate({
        historyKind: "artifacts",
        cursor: "eyJpZCI6IjAxSyJ9",
        limit: "20",
      }),
    ).toBe(true);
    expect(
      validate({
        historyKind: "unknown",
        limit: "41",
      }),
    ).toBe(false);
  });

  it("validates a bounded Asset detail with current origin and lineage", () => {
    const validate = createAjv().compile(WorkspaceAssetDetailSchema);
    expect(
      validate({
        id: "01K00000000000000000000001",
        name: "首页视觉",
        assetType: "image.canvas_export",
        lifecycleStatus: "active",
        version: 2,
        currentArtifact: {
          id: "01K00000000000000000000002",
          artifactType: "image.canvas_export",
          displayFilename: "homepage.png",
          mediaType: "image/png",
          byteSize: "2048",
          availabilityStatus: "available",
          dataClassification: "internal",
          isCurrent: true,
          brand: {
            brandKitId: "01K00000000000000000000005",
            brandKitRevisionId: "01K00000000000000000000006",
            name: "Kanvas 主品牌",
            revisionNumber: 3,
          },
          origin: {
            kind: "canvas_export",
            canvasDraftId: "01K00000000000000000000003",
            documentVersion: 4,
            pageId: "page-1",
            format: "png",
            width: 1080,
            height: 1080,
            transparentBackground: true,
            sourceArtifactCount: 1,
          },
          createdAt: "2026-08-05T01:00:00.000Z",
        },
        artifacts: [],
        artifactsTruncated: false,
        lineage: [
          {
            direction: "input",
            relation: "composed_from",
            artifact: {
              id: "01K00000000000000000000004",
              artifactType: "image.source",
              displayFilename: "source.png",
              mediaType: "image/png",
              createdAt: "2026-08-04T01:00:00.000Z",
            },
          },
        ],
        lineageTruncated: false,
        usedByBrands: [
          {
            brandKitId: "01K00000000000000000000005",
            name: "Kanvas 主品牌",
            isDefault: true,
            logoRole: "primary",
          },
        ],
        availableActions: ["reuse_on_canvas", "download_current"],
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-05T01:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("exposes only the current managed Artifact for each Asset", () => {
    const validate = createAjv().compile(WorkspaceAssetListSchema);
    expect(
      validate({
        items: [
          {
            id: "01K00000000000000000000001",
            assetKey: "background-removal-1.output",
            name: "透明底产品图",
            assetType: "image.cutout",
            lifecycleStatus: "active",
            currentArtifact: {
              id: "01K00000000000000000000003",
              artifactType: "image",
              displayFilename: "product-cutout.png",
              mediaType: "image/png",
              byteSize: "2048",
              availabilityStatus: "available",
              dataClassification: "internal",
              brand: {
                brandKitId: "01K00000000000000000000005",
                brandKitRevisionId: "01K00000000000000000000006",
                name: "Kanvas 主品牌",
                revisionNumber: 3,
              },
              createdAt: "2026-07-29T00:00:00.000Z",
            },
            version: 2,
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
        truncated: true,
        facets: {
          assetTypes: ["image.cutout", "image.source"],
        },
        nextCursor: "eyJpZCI6IjAxSyJ9",
      }),
    ).toBe(true);
  });

  it("bounds Asset search, media, and keyset pagination filters", () => {
    const validate = createAjv().compile(WorkspaceAssetListQuerySchema);

    expect(
      validate({
        q: "产品",
        mediaKind: "image",
        assetType: "image.source",
        lifecycleStatus: "active",
        cursor: "eyJpZCI6IjAxSyJ9",
        limit: "48",
      }),
    ).toBe(true);
    expect(
      validate({
        ids: ["01K00000000000000000000001", "01K00000000000000000000002"].join(
          ",",
        ),
        mediaKind: "image",
        lifecycleStatus: "active",
        limit: "24",
      }),
    ).toBe(true);
    expect(
      validate({
        q: "产品",
        mediaKind: "binary",
        limit: "101",
      }),
    ).toBe(false);
  });
});
