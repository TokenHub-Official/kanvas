import { describe, expect, it } from "vitest";

import {
  projectAgentBrandContext,
  projectAgentSurfaceContext,
} from "../src/modules/agent/index.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = `sha256:${"a".repeat(64)}`;

describe("Agent Surface Context projector", () => {
  it("preserves every admitted Brand reference and color", () => {
    const colors = Array.from({ length: 64 }, (_, index) => ({
      key: `color-${index}`,
      name: "Color",
      role: "primary" as const,
      value: "#3348FF",
      position: index,
    }));
    const referenceImages = Array.from({ length: 24 }, (_, index) => ({
      key: `reference-${index}`,
      name: "Reference",
      assetId: id(100 + index),
      artifactId: id(200 + index),
      position: index,
    }));
    const brand = projectAgentBrandContext({
      id: id(12),
      brandKitId: id(13),
      workspaceId: id(14),
      revisionNumber: 2,
      document: {
        schemaVersion: 1,
        name: "Brand",
        colors,
        logos: [],
        referenceImages,
        textStyles: [],
        guidelines: { principles: [], avoid: [] },
      },
      contentDigest: digest,
      publishedByPrincipalId: id(17),
      publishedAt: new Date("2026-08-24T20:00:00.000Z"),
    });
    expect(brand.colors).toHaveLength(64);
    expect(brand.referenceImages.map((image) => image.artifactId)).toEqual(
      referenceImages.map((image) => image.artifactId),
    );
    expect(() =>
      projectAgentSurfaceContext({
        surfaceKind: "agent_workspace",
        originSurface: "agent",
        attachedResourceIds: [],
        brandKitRevisionId: id(12),
        brand,
        selectedElementKeys: [],
        selectedArtifactIds: referenceImages.map((image) => image.artifactId),
        canUndo: false,
        canRedo: false,
      }),
    ).not.toThrow();
  });

  it("projects one Main Agent workspace with an optional Canvas reference", () => {
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "agent_workspace",
        originSurface: "canvas",
        attachedResourceIds: [id(1)],
        canvasDraftId: id(1),
        canvasDraftVersion: 4,
        pageKey: "page-1",
        selectedElementKeys: ["headline"],
        selectedArtifactIds: [],
        canUndo: true,
        canRedo: false,
      }),
    ).toMatchObject({
      surfaceKind: "agent_workspace",
      resource: { kind: "canvas_draft", resourceId: id(1), version: 4 },
      selectedElementKeys: ["headline"],
      surfaceState: {
        kind: "agent_workspace",
        originSurface: "canvas",
        attachmentState: "present",
        pageKey: "page-1",
      },
    });
  });

  it("makes an empty Workspace attachment state explicit", () => {
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "workspace_home",
        attachedResourceIds: [],
      }),
    ).toEqual({
      schemaVersion: 1,
      surfaceKind: "workspace_home",
      surfaceState: {
        kind: "workspace_home",
        attachmentState: "none",
        attachedResourceIds: [],
      },
    });
  });

  it("projects bounded Canvas selection, version, Undo and Brand facts", () => {
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "canvas",
        canvasDraftId: id(1),
        canvasDraftVersion: 7,
        pageKey: "page-1",
        selectedElementKeys: ["headline"],
        selectedArtifactIds: [id(2)],
        canUndo: true,
        canRedo: false,
        brandKitRevisionId: id(3),
      }),
    ).toMatchObject({
      surfaceKind: "canvas",
      resource: { kind: "canvas_draft", resourceId: id(1), version: 7 },
      brandKitRevisionId: id(3),
      selectedElementKeys: ["headline"],
      selectedArtifactIds: [id(2)],
      surfaceState: {
        kind: "canvas",
        pageKey: "page-1",
        canUndo: true,
        canRedo: false,
      },
    });
  });

  it("projects visible Brand choices without full Brand records", () => {
    const brand = projectAgentBrandContext({
      id: id(12),
      brandKitId: id(13),
      workspaceId: id(14),
      revisionNumber: 2,
      document: {
        schemaVersion: 1,
        name: "Kanvas Main",
        description: "Selected brand description",
        colors: [
          {
            key: "primary",
            name: "Primary blue",
            role: "primary",
            value: "#3348FF",
            position: 0,
          },
        ],
        logos: [
          {
            key: "main",
            name: "Main logo",
            role: "primary",
            assetId: id(15),
            artifactId: id(16),
            position: 0,
          },
        ],
        referenceImages: [
          {
            key: "photography",
            name: "Photography",
            description: "Natural light",
            assetId: id(18),
            artifactId: id(19),
            position: 0,
          },
        ],
        textStyles: [],
        guidelines: { principles: [], avoid: [] },
      },
      contentDigest: digest,
      publishedByPrincipalId: id(17),
      publishedAt: new Date("2026-08-24T20:00:00.000Z"),
    });
    expect(brand).toEqual({
      revisionId: id(12),
      name: "Kanvas Main",
      description: "Selected brand description",
      colors: [
        {
          key: "primary",
          name: "Primary blue",
          role: "primary",
          value: "#3348FFFF",
        },
      ],
      logos: [
        {
          key: "main",
          name: "Main logo",
          role: "primary",
          assetId: id(15),
          artifactId: id(16),
        },
      ],
      referenceImages: [
        {
          key: "photography",
          name: "Photography",
          description: "Natural light",
          artifactId: id(19),
        },
      ],
    });
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "workspace_home",
        attachedResourceIds: [],
        brandKitRevisionId: id(12),
        brand,
      }),
    ).toMatchObject({ brandKitRevisionId: id(12), brand });
  });

  it("uses one Review projection for Asset and Workflow Run surfaces", () => {
    for (const surfaceKind of ["asset", "workflow_run"] as const) {
      expect(
        projectAgentSurfaceContext({
          surfaceKind,
          resourceId: id(4),
          availableArtifactIds: [id(5), id(6)],
          selectedArtifactIds: [id(5)],
        }),
      ).toMatchObject({
        surfaceKind,
        resource: { kind: surfaceKind, resourceId: id(4) },
        surfaceState: {
          kind: "review",
          availableArtifactIds: [id(5), id(6)],
        },
      });
    }
  });

  it("projects Brand Draft and Workflow Authoring optimistic-lock facts", () => {
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "brand",
        brandDraftId: id(7),
        brandDraftVersion: 3,
        publishedBrandKitRevisionId: id(8),
        editingSection: "colors",
        selectedArtifactIds: [],
      }),
    ).toMatchObject({
      resource: { kind: "brand_kit_draft", version: 3 },
      surfaceState: {
        kind: "brand",
        editingSection: "colors",
        publishedBrandKitRevisionId: id(8),
      },
    });
    expect(
      projectAgentSurfaceContext({
        surfaceKind: "workflow_authoring",
        workflowDefinitionId: id(9),
        workflowDraftVersion: 4,
        selectedNodeKeys: ["prepare"],
        graphDigest: digest,
        validationStatus: "valid",
        testStatus: "passed",
      }),
    ).toMatchObject({
      resource: { kind: "workflow_definition", version: 4 },
      surfaceState: {
        kind: "workflow_authoring",
        selectedNodeKeys: ["prepare"],
        graphDigest: digest,
        validationStatus: "valid",
        testStatus: "passed",
      },
    });
  });

  it("rejects invisible IDs, duplicate selections and invalid digests", () => {
    expect(() =>
      projectAgentSurfaceContext({
        surfaceKind: "workspace_home",
        attachedResourceIds: ["not-an-id"],
      }),
    ).toThrow(/ULID/u);
    expect(() =>
      projectAgentSurfaceContext({
        surfaceKind: "canvas",
        canvasDraftId: id(10),
        canvasDraftVersion: 1,
        selectedElementKeys: ["same", "same"],
        selectedArtifactIds: [],
        canUndo: false,
        canRedo: false,
      }),
    ).toThrow(/unique/u);
    expect(() =>
      projectAgentSurfaceContext({
        surfaceKind: "workflow_authoring",
        workflowDefinitionId: id(11),
        workflowDraftVersion: 1,
        selectedNodeKeys: [],
        graphDigest: "not-a-digest",
        validationStatus: "not_run",
        testStatus: "not_run",
      }),
    ).toThrow(/graphDigest/u);
  });
});
