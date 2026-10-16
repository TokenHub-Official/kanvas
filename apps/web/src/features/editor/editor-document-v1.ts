import type {
  EditorDocumentV1,
  EditorDraftContentV1,
  EditorNodeV1,
  EditorPlacedImageV1,
} from "@kanvas/contracts/editor";

import {
  createEditorRuntimeDocumentV1,
  serializeEditorRuntimeDocumentV1,
  type EditorRuntimeDocumentV1,
} from "./editor-runtime-v1.js";

export interface EditorArtifactRuntimeResourceV1 {
  readonly artifactId: string;
  readonly sourceQuality?: "original" | "preview";
  readonly sourceUnavailable: boolean;
  readonly sourceUrl?: string;
}

export interface HydratedEditorDocumentV1 {
  readonly document: EditorDocumentV1;
  readonly resources: ReadonlyMap<string, EditorArtifactRuntimeResourceV1>;
}

export interface HydratedEditorRuntimeDocumentV1 {
  readonly document: EditorRuntimeDocumentV1;
  readonly resources: HydratedEditorDocumentV1["resources"];
}

export function normalizeEditorDocumentV1(
  document: EditorDocumentV1,
): EditorDocumentV1 {
  return document;
}

function collectPlacedImageArtifact(
  artifactIds: Set<string>,
  image: EditorPlacedImageV1,
): void {
  artifactIds.add(image.source.artifactId);
}

function collectNodeArtifacts(
  artifactIds: Set<string>,
  node: EditorNodeV1,
): void {
  if (node.kind === "image") {
    collectPlacedImageArtifact(artifactIds, node.image);
    return;
  }
  if (node.kind === "graphic" && node.source.kind === "artifact") {
    artifactIds.add(node.source.artifactId);
    return;
  }
  if (node.kind === "frame" && node.content) {
    collectPlacedImageArtifact(artifactIds, node.content.image);
    return;
  }
  if (node.kind === "grid") {
    for (const cell of node.cells) {
      if (cell.content) {
        collectPlacedImageArtifact(artifactIds, cell.content.image);
      }
    }
    return;
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      collectNodeArtifacts(artifactIds, child);
    }
  }
}

export function editorDocumentV1ArtifactIds(
  document: EditorDocumentV1,
): readonly string[] {
  const artifactIds = new Set<string>();
  for (const page of document.pages) {
    if (page.background.kind === "image") {
      collectPlacedImageArtifact(artifactIds, page.background.image);
    }
    for (const node of page.nodes) {
      collectNodeArtifacts(artifactIds, node);
    }
  }
  return [...artifactIds];
}

export async function hydrateEditorDocumentV1(
  document: EditorDocumentV1,
  resolveArtifactSource: (artifactId: string) => Promise<string>,
): Promise<HydratedEditorDocumentV1> {
  const entries = await Promise.all(
    editorDocumentV1ArtifactIds(document).map(
      async (
        artifactId,
      ): Promise<readonly [string, EditorArtifactRuntimeResourceV1]> => {
        try {
          const sourceUrl = await resolveArtifactSource(artifactId);
          return [
            artifactId,
            {
              artifactId,
              sourceUrl,
              sourceUnavailable: false,
            },
          ];
        } catch {
          return [
            artifactId,
            {
              artifactId,
              sourceUnavailable: true,
            },
          ];
        }
      },
    ),
  );

  return {
    document,
    resources: new Map(entries),
  };
}

export async function hydrateEditorRuntimeDocumentV1(
  document: EditorDocumentV1,
  resolveArtifactSource: (artifactId: string) => Promise<string>,
): Promise<HydratedEditorRuntimeDocumentV1> {
  const normalized = normalizeEditorDocumentV1(document);
  const hydrated = await hydrateEditorDocumentV1(
    normalized,
    resolveArtifactSource,
  );
  return {
    document: createEditorRuntimeDocumentV1(hydrated.document),
    resources: hydrated.resources,
  };
}

export function createEditorDraftContentV1(
  document: EditorRuntimeDocumentV1,
  title = document.title,
): EditorDraftContentV1 {
  const durable = serializeEditorRuntimeDocumentV1(document);
  return {
    schemaVersion: durable.schemaVersion,
    title: title.trim() || "未命名画板",
    pages: durable.pages,
    metadata: durable.metadata,
  };
}

export function editorArtifactSourceUrlV1(
  resources: HydratedEditorDocumentV1["resources"],
  artifactId: string,
): string | undefined {
  return resources.get(artifactId)?.sourceUrl;
}
