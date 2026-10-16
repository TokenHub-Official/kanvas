import type {
  AgentBrandContextV1,
  AgentContextSnapshotV1,
  AgentResourceContext,
} from "./agent-runtime.js";
import type { BrandKitRevisionRecord } from "../../brand/application/workspace-brand.js";

type OptionalBrandContext = {
  readonly brandKitRevisionId?: string;
  readonly brand?: AgentBrandContextV1;
};

export type AgentSurfaceContextInput =
  | (OptionalBrandContext & {
      readonly surfaceKind: "agent_workspace";
      readonly browserCanvasExport?: boolean;
      readonly selectedLibraryIds?: readonly string[];
      readonly libraryTools?: boolean;
      readonly originSurface: "agent" | "canvas" | "workspace_home";
      readonly attachedResourceIds: readonly string[];
      readonly canvasDraftId?: string;
      readonly canvasDraftVersion?: number;
      readonly pageKey?: string;
      readonly selectedElementKeys: readonly string[];
      readonly selectedArtifactIds: readonly string[];
      readonly canUndo: boolean;
      readonly canRedo: boolean;
      readonly requestedSkill?: {
        readonly skillRevisionId: string;
        readonly displayName: string;
        readonly source?: "published" | "candidate";
      };
    })
  | (OptionalBrandContext & {
      readonly surfaceKind: "workspace_home";
      readonly attachedResourceIds: readonly string[];
    })
  | (OptionalBrandContext & {
      readonly surfaceKind: "canvas";
      readonly canvasDraftId: string;
      readonly canvasDraftVersion: number;
      readonly pageKey?: string;
      readonly selectedElementKeys: readonly string[];
      readonly selectedArtifactIds: readonly string[];
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    })
  | (OptionalBrandContext & {
      readonly surfaceKind: "asset" | "workflow_run";
      readonly resourceId: string;
      readonly resourceVersion?: number;
      readonly availableArtifactIds: readonly string[];
      readonly selectedArtifactIds: readonly string[];
    })
  | {
      readonly surfaceKind: "brand";
      readonly brandDraftId: string;
      readonly brandDraftVersion: number;
      readonly publishedBrandKitRevisionId?: string;
      readonly editingSection?: string;
      readonly selectedArtifactIds: readonly string[];
    }
  | {
      readonly surfaceKind: "workflow_authoring";
      readonly workflowDefinitionId: string;
      readonly workflowDraftVersion: number;
      readonly selectedNodeKeys: readonly string[];
      readonly graphDigest: string;
      readonly validationStatus: "not_run" | "valid" | "invalid";
      readonly testStatus: "not_run" | "running" | "passed" | "failed";
    };

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const brandColorRoles = new Set([
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text_primary",
  "text_secondary",
]);
const brandLogoRoles = new Set(["primary", "inverse", "icon"]);

function id(value: string, label: string): string {
  if (!idPattern.test(value)) {
    throw new TypeError(`${label} must be a canonical ULID.`);
  }
  return value;
}

function version(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function keys(
  values: readonly string[],
  label: string,
  maximumItems: number,
): readonly string[] {
  if (
    values.length > maximumItems ||
    new Set(values).size !== values.length ||
    values.some(
      (value) =>
        value.length < 1 ||
        value.length > 160 ||
        [...value].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        }),
    )
  ) {
    throw new TypeError(`${label} must be a bounded unique key list.`);
  }
  return Object.freeze([...values]);
}

function ids(
  values: readonly string[],
  label: string,
  maximumItems: number,
): readonly string[] {
  if (values.length > maximumItems || new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be a bounded unique ID list.`);
  }
  values.forEach((value) => id(value, label));
  return Object.freeze([...values]);
}

function optionalId(value: string | undefined, label: string) {
  return value ? id(value, label) : undefined;
}

function text(value: string, label: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length < 1 || normalized.length > maximumLength) {
    throw new TypeError(`${label} must be bounded text.`);
  }
  return normalized;
}

function projectedBrand(
  brandKitRevisionId: string | undefined,
  brand: AgentBrandContextV1 | undefined,
): {
  readonly brandKitRevisionId?: string;
  readonly brand?: AgentBrandContextV1;
} {
  const revisionId = optionalId(brandKitRevisionId, "brandKitRevisionId");
  if (!brand) {
    return revisionId ? Object.freeze({ brandKitRevisionId: revisionId }) : {};
  }
  if (!revisionId || brand.revisionId !== revisionId) {
    throw new TypeError("Brand Context must match its pinned Revision.");
  }
  if (
    brand.colors.length > 64 ||
    brand.logos.length > 12 ||
    (brand.referenceImages?.length ?? 0) > 24
  ) {
    throw new TypeError("Brand Context exceeds its bounded projection.");
  }
  const colorKeys = keys(
    brand.colors.map((color) => color.key),
    "Brand color keys",
    64,
  );
  const logoKeys = keys(
    brand.logos.map((logo) => logo.key),
    "Brand logo keys",
    12,
  );
  const referenceImageKeys = keys(
    (brand.referenceImages ?? []).map((reference) => reference.key),
    "Brand reference image keys",
    24,
  );
  const projected = Object.freeze({
    revisionId,
    name: text(brand.name, "Brand name", 160),
    ...(brand.description
      ? { description: text(brand.description, "Brand description", 500) }
      : {}),
    colors: Object.freeze(
      brand.colors.map((color, index) => {
        if (
          !brandColorRoles.has(color.role) ||
          !/^#[0-9A-F]{8}$/u.test(color.value)
        ) {
          throw new TypeError("Brand color value must be canonical RGBA hex.");
        }
        return Object.freeze({
          key: colorKeys[index]!,
          name: text(color.name, "Brand color name", 120),
          role: color.role,
          value: color.value,
        });
      }),
    ),
    logos: Object.freeze(
      brand.logos.map((logo, index) => {
        if (!brandLogoRoles.has(logo.role)) {
          throw new TypeError("Brand logo role is invalid.");
        }
        return Object.freeze({
          key: logoKeys[index]!,
          name: text(logo.name, "Brand logo name", 120),
          role: logo.role,
          ...(logo.assetId
            ? { assetId: id(logo.assetId, "Brand logo Asset ID") }
            : {}),
          artifactId: id(logo.artifactId, "Brand logo Artifact ID"),
        });
      }),
    ),
    referenceImages: Object.freeze(
      (brand.referenceImages ?? []).map((reference, index) =>
        Object.freeze({
          key: referenceImageKeys[index]!,
          name: text(reference.name, "Brand reference image name", 120),
          ...(reference.description
            ? {
                description: text(
                  reference.description,
                  "Brand reference image description",
                  500,
                ),
              }
            : {}),
          artifactId: id(
            reference.artifactId,
            "Brand reference image Artifact ID",
          ),
        }),
      ),
    ),
  });
  return Object.freeze({ brandKitRevisionId: revisionId, brand: projected });
}

export function projectAgentBrandContext(
  revision: BrandKitRevisionRecord,
): AgentBrandContextV1 {
  const revisionId = id(revision.id, "Brand Revision ID");
  const colors = revision.document.colors
    .toSorted((left, right) => left.position - right.position)
    .map((color) =>
      Object.freeze({
        key: keys([color.key], "Brand color key", 1)[0]!,
        name: text(color.name, "Brand color name", 120),
        role: color.role,
        value:
          color.value.length === 7
            ? `${color.value.toUpperCase()}FF`
            : color.value.toUpperCase(),
      }),
    );
  const logos = revision.document.logos
    .toSorted((left, right) => left.position - right.position)
    .slice(0, 12)
    .map((logo) =>
      Object.freeze({
        key: keys([logo.key], "Brand logo key", 1)[0]!,
        name: text(logo.name, "Brand logo name", 120),
        role: logo.role,
        assetId: id(logo.assetId, "Brand logo Asset ID"),
        artifactId: id(logo.artifactId, "Brand logo Artifact ID"),
      }),
    );
  const referenceImages = (revision.document.referenceImages ?? [])
    .toSorted((left, right) => left.position - right.position)
    .map((reference) =>
      Object.freeze({
        key: keys([reference.key], "Brand reference image key", 1)[0]!,
        name: text(reference.name, "Brand reference image name", 120),
        ...(reference.description
          ? {
              description: text(
                reference.description,
                "Brand reference image description",
                500,
              ),
            }
          : {}),
        artifactId: id(
          reference.artifactId,
          "Brand reference image Artifact ID",
        ),
      }),
    );
  return Object.freeze({
    revisionId,
    name: text(revision.document.name, "Brand name", 160),
    ...(revision.document.description
      ? {
          description: text(
            revision.document.description,
            "Brand description",
            500,
          ),
        }
      : {}),
    colors: Object.freeze(colors),
    logos: Object.freeze(logos),
    referenceImages: Object.freeze(referenceImages),
  });
}

function resource(
  kind: AgentResourceContext["kind"],
  resourceId: string,
  resourceVersion?: number,
): AgentResourceContext {
  return Object.freeze({
    kind,
    resourceId: id(resourceId, `${kind} resource ID`),
    ...(resourceVersion === undefined
      ? {}
      : { version: version(resourceVersion, `${kind} version`) }),
  });
}

export function projectAgentSurfaceContext(
  input: AgentSurfaceContextInput,
): AgentContextSnapshotV1 {
  switch (input.surfaceKind) {
    case "agent_workspace": {
      const attachedResourceIds = ids(
        input.attachedResourceIds,
        "attachedResourceIds",
        32,
      );
      if (
        (input.canvasDraftId === undefined) !==
        (input.canvasDraftVersion === undefined)
      ) {
        throw new TypeError(
          "Canvas Draft context must include both its ID and version.",
        );
      }
      return Object.freeze({
        schemaVersion: 1,
        ...(input.browserCanvasExport ? { browserCanvasExport: true } : {}),
        surfaceKind: input.surfaceKind,
        ...(input.canvasDraftId && input.canvasDraftVersion
          ? {
              resource: resource(
                "canvas_draft",
                input.canvasDraftId,
                input.canvasDraftVersion,
              ),
            }
          : {}),
        ...projectedBrand(input.brandKitRevisionId, input.brand),
        selectedElementKeys: keys(
          input.selectedElementKeys,
          "selectedElementKeys",
          200,
        ),
        selectedArtifactIds: ids(
          input.selectedArtifactIds,
          "selectedArtifactIds",
          64,
        ),
        ...(input.libraryTools ? { libraryTools: true } : {}),
        ...(input.selectedLibraryIds
          ? {
              selectedLibraryIds: ids(
                input.selectedLibraryIds,
                "selectedLibraryIds",
                8,
              ),
            }
          : {}),
        ...(input.requestedSkill
          ? {
              requestedSkill: Object.freeze({
                skillRevisionId: id(
                  input.requestedSkill.skillRevisionId,
                  "requestedSkill.skillRevisionId",
                ),
                displayName: text(
                  input.requestedSkill.displayName,
                  "requestedSkill.displayName",
                  240,
                ),
                source: input.requestedSkill.source ?? "published",
              }),
            }
          : {}),
        surfaceState: Object.freeze({
          kind: "agent_workspace" as const,
          originSurface: input.originSurface,
          attachmentState:
            attachedResourceIds.length === 0 ? "none" : "present",
          attachedResourceIds,
          ...(input.pageKey
            ? { pageKey: keys([input.pageKey], "pageKey", 1)[0] }
            : {}),
          canUndo: input.canUndo,
          canRedo: input.canRedo,
        }),
      });
    }
    case "workspace_home": {
      const attachedResourceIds = ids(
        input.attachedResourceIds,
        "attachedResourceIds",
        32,
      );
      return Object.freeze({
        schemaVersion: 1,
        surfaceKind: input.surfaceKind,
        ...projectedBrand(input.brandKitRevisionId, input.brand),
        surfaceState: Object.freeze({
          kind: "workspace_home",
          attachmentState:
            attachedResourceIds.length === 0 ? "none" : "present",
          attachedResourceIds,
        }),
      });
    }
    case "canvas":
      return Object.freeze({
        schemaVersion: 1,
        surfaceKind: input.surfaceKind,
        resource: resource(
          "canvas_draft",
          input.canvasDraftId,
          input.canvasDraftVersion,
        ),
        ...projectedBrand(input.brandKitRevisionId, input.brand),
        selectedElementKeys: keys(
          input.selectedElementKeys,
          "selectedElementKeys",
          200,
        ),
        selectedArtifactIds: ids(
          input.selectedArtifactIds,
          "selectedArtifactIds",
          64,
        ),
        surfaceState: Object.freeze({
          kind: "canvas",
          ...(input.pageKey
            ? { pageKey: keys([input.pageKey], "pageKey", 1)[0] }
            : {}),
          canUndo: input.canUndo,
          canRedo: input.canRedo,
        }),
      });
    case "asset":
    case "workflow_run":
      return Object.freeze({
        schemaVersion: 1,
        surfaceKind: input.surfaceKind,
        resource: resource(
          input.surfaceKind,
          input.resourceId,
          input.resourceVersion,
        ),
        ...projectedBrand(input.brandKitRevisionId, input.brand),
        selectedArtifactIds: ids(
          input.selectedArtifactIds,
          "selectedArtifactIds",
          64,
        ),
        surfaceState: Object.freeze({
          kind: "review",
          availableArtifactIds: ids(
            input.availableArtifactIds,
            "availableArtifactIds",
            100,
          ),
        }),
      });
    case "brand":
      return Object.freeze({
        schemaVersion: 1,
        surfaceKind: input.surfaceKind,
        resource: resource(
          "brand_kit_draft",
          input.brandDraftId,
          input.brandDraftVersion,
        ),
        ...(optionalId(
          input.publishedBrandKitRevisionId,
          "publishedBrandKitRevisionId",
        )
          ? { brandKitRevisionId: input.publishedBrandKitRevisionId }
          : {}),
        selectedArtifactIds: ids(
          input.selectedArtifactIds,
          "selectedArtifactIds",
          64,
        ),
        surfaceState: Object.freeze({
          kind: "brand",
          ...(input.editingSection
            ? {
                editingSection: keys(
                  [input.editingSection],
                  "editingSection",
                  1,
                )[0],
              }
            : {}),
          ...(input.publishedBrandKitRevisionId
            ? {
                publishedBrandKitRevisionId: input.publishedBrandKitRevisionId,
              }
            : {}),
        }),
      });
    case "workflow_authoring":
      if (!digestPattern.test(input.graphDigest)) {
        throw new TypeError("graphDigest must be a canonical SHA-256 digest.");
      }
      return Object.freeze({
        schemaVersion: 1,
        surfaceKind: input.surfaceKind,
        resource: resource(
          "workflow_definition",
          input.workflowDefinitionId,
          input.workflowDraftVersion,
        ),
        surfaceState: Object.freeze({
          kind: "workflow_authoring",
          selectedNodeKeys: keys(
            input.selectedNodeKeys,
            "selectedNodeKeys",
            100,
          ),
          graphDigest: input.graphDigest,
          validationStatus: input.validationStatus,
          testStatus: input.testStatus,
        }),
      });
  }
}
