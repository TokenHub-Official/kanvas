import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  CanvasDraftListSchema,
  CanvasDraftSummarySchema,
  CanvasDraftRevisionSchema,
  CanvasDraftSchema,
  CreateCanvasDraftBodySchema,
  createCanvasDraftRoute,
  getCanvasDraftRoute,
  getCanvasDraftRevisionRoute,
  listCanvasDraftsRoute,
  listCanvasDraftRevisionsRoute,
  RestoreCanvasDraftBodySchema,
  restoreCanvasDraftRoute,
  routeRegistry,
  UpdateCanvasDraftBrandBodySchema,
  updateCanvasDraftBrandRoute,
  updateCanvasDraftRoute,
} from "../src/api/index.js";

const document = {
  schemaVersion: "kanvas.editor-document/v1",
  title: "V1 活动主视觉",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: {
        kind: "transparent",
      },
      nodes: [
        {
          id: "shape-1",
          name: "流程判断",
          kind: "shape",
          transform: {
            x: 200,
            y: 240,
            width: 520,
            height: 320,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          definition: {
            catalogId: "kanvas.core.shapes",
            definitionId: "flowchart.decision",
            revision: "2026-07-31",
          },
          parameters: {},
          fill: {
            kind: "solid",
            color: "#3048f5",
          },
          stroke: {
            paint: {
              kind: "none",
            },
            width: 0,
            alignment: "center",
          },
        },
      ],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
} as const;

FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));

describe("Canvas Draft API contract", () => {
  it("registers create, read, history, restore and optimistic update routes", () => {
    expect(routeRegistry).toContain(createCanvasDraftRoute);
    expect(routeRegistry).toContain(listCanvasDraftsRoute);
    expect(routeRegistry).toContain(getCanvasDraftRoute);
    expect(routeRegistry).toContain(listCanvasDraftRevisionsRoute);
    expect(routeRegistry).toContain(getCanvasDraftRevisionRoute);
    expect(routeRegistry).toContain(restoreCanvasDraftRoute);
    expect(routeRegistry).toContain(updateCanvasDraftRoute);
    expect(routeRegistry).toContain(updateCanvasDraftBrandRoute);
    expect(createCanvasDraftRoute.idempotency).toBe("required");
    expect(updateCanvasDraftRoute.method).toBe("PUT");
  });

  it("accepts bounded recent Draft summaries without loading full documents", () => {
    const summary = {
      id: "01K00000000000000000000001",
      workspaceId: "01K00000000000000000000002",
      brand: {
        brandKitId: "01K00000000000000000000008",
        brandKitRevisionId: "01K00000000000000000000009",
        name: "Acme 主品牌",
        revisionNumber: 2,
      },
      title: "活动主视觉",
      pageCount: 2,
      version: 4,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:01:00.000Z",
    };
    expect(Value.Check(CanvasDraftSummarySchema, summary)).toBe(true);
    expect(
      Value.Check(CanvasDraftListSchema, {
        items: [summary],
        truncated: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(CanvasDraftSummarySchema, {
        ...summary,
        pageCount: 0,
      }),
    ).toBe(false);
  });

  it("accepts immutable revision facts and only explicit restore requests", () => {
    expect(
      Value.Check(CanvasDraftRevisionSchema, {
        canvasDraftId: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        version: 4,
        title: "活动主视觉",
        contentDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "restore",
        restoredFromVersion: 2,
        createdByPrincipalId: "01K00000000000000000000003",
        createdAt: "2026-07-29T00:01:00.000Z",
        document: {
          ...document,
          documentId: "01K00000000000000000000001",
          workspaceId: "01K00000000000000000000002",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(RestoreCanvasDraftBodySchema, {
        expectedVersion: 4,
        sourceVersion: 2,
      }),
    ).toBe(true);
    expect(
      Value.Check(RestoreCanvasDraftBodySchema, {
        sourceVersion: 2,
      }),
    ).toBe(false);
    expect(
      Value.Check(UpdateCanvasDraftBrandBodySchema, {
        expectedVersion: 4,
        brandKitRevisionId: "01K00000000000000000000009",
      }),
    ).toBe(true);
    expect(
      Value.Check(CanvasDraftRevisionSchema, {
        canvasDraftId: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        version: 5,
        title: "活动主视觉",
        contentDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "brand_update",
        brand: {
          brandKitId: "01K00000000000000000000008",
          brandKitRevisionId: "01K00000000000000000000009",
          name: "Acme 主品牌",
          revisionNumber: 2,
        },
        createdByPrincipalId: "01K00000000000000000000003",
        createdAt: "2026-07-29T00:01:00.000Z",
        document: {
          ...document,
          documentId: "01K00000000000000000000001",
          workspaceId: "01K00000000000000000000002",
        },
      }),
    ).toBe(true);
  });

  it("accepts renderer-independent draft content", () => {
    expect(Value.Check(CreateCanvasDraftBodySchema, { document })).toBe(true);
    expect(
      Value.Check(CreateCanvasDraftBodySchema, {
        document,
        brandKitRevisionId: "01K00000000000000000000009",
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateCanvasDraftBodySchema, {
        document,
        brandKitRevisionId: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateCanvasDraftBodySchema, {
        document: {
          ...document,
          konvaNodeTree: {},
        },
      }),
    ).toBe(false);
  });

  it("accepts the current node document and rejects the retired schema", () => {
    expect(
      Value.Check(CreateCanvasDraftBodySchema, {
        document,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateCanvasDraftBodySchema, {
        document: {
          ...document,
          schemaVersion: "kanvas.editor-document/retired",
        },
      }),
    ).toBe(false);
  });

  it("pins the server-owned document and Workspace identities", () => {
    expect(
      Value.Check(CanvasDraftSchema, {
        id: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        brand: {
          brandKitId: "01K00000000000000000000008",
          brandKitRevisionId: "01K00000000000000000000009",
          name: "Acme 主品牌",
          revisionNumber: 2,
        },
        document: {
          ...document,
          documentId: "01K00000000000000000000001",
          workspaceId: "01K00000000000000000000002",
        },
        version: 3,
        createdByPrincipalId: "01K00000000000000000000003",
        updatedByPrincipalId: "01K00000000000000000000004",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:01:00.000Z",
      }),
    ).toBe(true);
  });
});
