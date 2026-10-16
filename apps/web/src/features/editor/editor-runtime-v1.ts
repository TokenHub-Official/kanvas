import type {
  EditorArtifactReferenceV1,
  EditorDocumentV1,
  EditorFrameNodeV1,
  EditorGridNodeV1,
  EditorGroupNodeV1,
  EditorImageNodeV1,
  EditorNodeV1,
  EditorPageBackgroundV1,
  EditorPageV1,
  EditorPlacedImageV1,
} from "@kanvas/contracts/editor";

export interface EditorLocalImageSourceV1 {
  readonly kind: "local";
  readonly localId: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly name: string;
  readonly previewUrl: string;
  readonly size: number;
  readonly uploadState: "failed" | "uploading";
}

export type EditorRuntimeImageSourceV1 =
  EditorArtifactReferenceV1 | EditorLocalImageSourceV1;

export type EditorRuntimePlacedImageV1 = Omit<EditorPlacedImageV1, "source"> & {
  readonly source: EditorRuntimeImageSourceV1;
};

export type EditorRuntimeImageNodeV1 = Omit<EditorImageNodeV1, "image"> & {
  readonly image: EditorRuntimePlacedImageV1;
};

export type EditorRuntimeFrameNodeV1 = Omit<EditorFrameNodeV1, "content"> & {
  readonly content?: {
    readonly image: EditorRuntimePlacedImageV1;
  };
};

export type EditorRuntimeGridNodeV1 = Omit<EditorGridNodeV1, "cells"> & {
  readonly cells: readonly {
    readonly slotId: string;
    readonly content?: {
      readonly image: EditorRuntimePlacedImageV1;
    };
  }[];
};

export type EditorRuntimeGroupNodeV1 = Omit<EditorGroupNodeV1, "children"> & {
  readonly children: readonly EditorRuntimeNodeV1[];
};

export type EditorRuntimeNodeV1 =
  | Exclude<
      EditorNodeV1,
      | EditorFrameNodeV1
      | EditorGridNodeV1
      | EditorGroupNodeV1
      | EditorImageNodeV1
    >
  | EditorRuntimeFrameNodeV1
  | EditorRuntimeGridNodeV1
  | EditorRuntimeGroupNodeV1
  | EditorRuntimeImageNodeV1;

export type EditorRuntimePageBackgroundV1 =
  | Exclude<EditorPageBackgroundV1, { readonly kind: "image" }>
  | {
      readonly image: EditorRuntimePlacedImageV1;
      readonly kind: "image";
      readonly opacity: number;
    };

export type EditorRuntimePageV1 = Omit<EditorPageV1, "background" | "nodes"> & {
  readonly background: EditorRuntimePageBackgroundV1;
  readonly nodes: readonly EditorRuntimeNodeV1[];
};

export type EditorRuntimeDocumentV1 = Omit<EditorDocumentV1, "pages"> & {
  readonly pages: readonly EditorRuntimePageV1[];
};

function collectRuntimePlacedImageArtifactV1(
  artifactIds: Set<string>,
  image: EditorRuntimePlacedImageV1,
): void {
  if (image.source.kind === "artifact") {
    artifactIds.add(image.source.artifactId);
  }
}

function collectRuntimeNodeArtifactsV1(
  artifactIds: Set<string>,
  node: EditorRuntimeNodeV1,
): void {
  if (node.kind === "image") {
    collectRuntimePlacedImageArtifactV1(artifactIds, node.image);
    return;
  }
  if (node.kind === "graphic" && node.source.kind === "artifact") {
    artifactIds.add(node.source.artifactId);
    return;
  }
  if (node.kind === "frame" && node.content) {
    collectRuntimePlacedImageArtifactV1(artifactIds, node.content.image);
    return;
  }
  if (node.kind === "grid") {
    for (const cell of node.cells) {
      if (cell.content) {
        collectRuntimePlacedImageArtifactV1(artifactIds, cell.content.image);
      }
    }
    return;
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      collectRuntimeNodeArtifactsV1(artifactIds, child);
    }
  }
}

export function editorRuntimePageArtifactIdsV1(
  page: EditorRuntimePageV1,
): readonly string[] {
  const artifactIds = new Set<string>();
  if (page.background.kind === "image") {
    collectRuntimePlacedImageArtifactV1(artifactIds, page.background.image);
  }
  for (const node of page.nodes) {
    collectRuntimeNodeArtifactsV1(artifactIds, node);
  }
  return [...artifactIds];
}

export interface EditorRuntimeSerializationDiagnosticV1 {
  readonly code: "pending_local_source";
  readonly localId: string;
  readonly nodeId?: string;
  readonly pageId: string;
}

function runtimePlacedImage(
  image: EditorPlacedImageV1,
): EditorRuntimePlacedImageV1 {
  return image;
}

function runtimeNode(node: EditorNodeV1): EditorRuntimeNodeV1 {
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map(runtimeNode),
    };
  }
  if (node.kind === "line") {
    return {
      ...node,
      role:
        node.role ?? (node.id.startsWith("drawing:") ? "freehand" : "design"),
      capStyle: node.capStyle ?? "round",
      joinStyle: node.joinStyle ?? "round",
    };
  }
  return node;
}

export function createEditorRuntimeDocumentV1(
  document: EditorDocumentV1,
): EditorRuntimeDocumentV1 {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      background:
        page.background.kind === "image"
          ? {
              ...page.background,
              image: runtimePlacedImage(page.background.image),
            }
          : page.background,
      nodes: page.nodes.map(runtimeNode),
    })),
  };
}

function localPlacedImageDiagnostic(
  image: EditorRuntimePlacedImageV1,
  pageId: string,
  nodeId?: string,
): EditorRuntimeSerializationDiagnosticV1 | undefined {
  return image.source.kind === "local"
    ? {
        code: "pending_local_source",
        localId: image.source.localId,
        pageId,
        ...(nodeId ? { nodeId } : {}),
      }
    : undefined;
}

function collectNodeDiagnostics(
  diagnostics: EditorRuntimeSerializationDiagnosticV1[],
  node: EditorRuntimeNodeV1,
  pageId: string,
): void {
  if (node.kind === "image") {
    const diagnostic = localPlacedImageDiagnostic(node.image, pageId, node.id);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
    return;
  }
  if (node.kind === "frame" && node.content) {
    const diagnostic = localPlacedImageDiagnostic(
      node.content.image,
      pageId,
      node.id,
    );
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
    return;
  }
  if (node.kind === "grid") {
    for (const cell of node.cells) {
      if (cell.content) {
        const diagnostic = localPlacedImageDiagnostic(
          cell.content.image,
          pageId,
          node.id,
        );
        if (diagnostic) {
          diagnostics.push(diagnostic);
        }
      }
    }
    return;
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      collectNodeDiagnostics(diagnostics, child, pageId);
    }
  }
}

export function editorRuntimeSerializationDiagnosticsV1(
  document: EditorRuntimeDocumentV1,
): readonly EditorRuntimeSerializationDiagnosticV1[] {
  const diagnostics: EditorRuntimeSerializationDiagnosticV1[] = [];
  for (const page of document.pages) {
    if (page.background.kind === "image") {
      const diagnostic = localPlacedImageDiagnostic(
        page.background.image,
        page.id,
      );
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }
    for (const node of page.nodes) {
      collectNodeDiagnostics(diagnostics, node, page.id);
    }
  }
  return diagnostics;
}

function durablePlacedImage(
  image: EditorRuntimePlacedImageV1,
): EditorPlacedImageV1 {
  if (image.source.kind === "local") {
    throw new Error(`Local image ${image.source.localId} is not durable.`);
  }
  return {
    ...image,
    source: image.source,
  };
}

function durableNode(node: EditorRuntimeNodeV1): EditorNodeV1 {
  if (node.kind === "image") {
    return {
      ...node,
      image: durablePlacedImage(node.image),
    };
  }
  if (node.kind === "frame") {
    const { content, ...frame } = node;
    return {
      ...frame,
      ...(content
        ? {
            content: {
              image: durablePlacedImage(content.image),
            },
          }
        : {}),
    };
  }
  if (node.kind === "grid") {
    return {
      ...node,
      cells: node.cells.map((cell) => ({
        slotId: cell.slotId,
        ...(cell.content
          ? {
              content: {
                image: durablePlacedImage(cell.content.image),
              },
            }
          : {}),
      })),
    };
  }
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map(durableNode),
    };
  }
  return node;
}

export function serializeEditorRuntimeDocumentV1(
  document: EditorRuntimeDocumentV1,
): EditorDocumentV1 {
  const diagnostics = editorRuntimeSerializationDiagnosticsV1(document);
  if (diagnostics.length > 0) {
    throw new Error(
      `Canvas document has ${String(
        diagnostics.length,
      )} pending local image source(s).`,
    );
  }
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      background:
        page.background.kind === "image"
          ? {
              ...page.background,
              image: durablePlacedImage(page.background.image),
            }
          : page.background,
      nodes: page.nodes.map(durableNode),
    })),
  };
}

function commitPlacedImage(
  image: EditorRuntimePlacedImageV1,
  localId: string,
  reference: EditorArtifactReferenceV1,
): EditorRuntimePlacedImageV1 {
  return image.source.kind === "local" && image.source.localId === localId
    ? {
        ...image,
        source: reference,
      }
    : image;
}

function markPlacedImageFailed(
  image: EditorRuntimePlacedImageV1,
  localId: string,
): EditorRuntimePlacedImageV1 {
  return image.source.kind === "local" && image.source.localId === localId
    ? {
        ...image,
        source: {
          ...image.source,
          uploadState: "failed",
        },
      }
    : image;
}

function restorePlacedImagePreview(
  image: EditorRuntimePlacedImageV1,
  localId: string,
  previewUrl: string,
): EditorRuntimePlacedImageV1 {
  return image.source.kind === "local" && image.source.localId === localId
    ? {
        ...image,
        source: {
          ...image.source,
          previewUrl,
          uploadState: "uploading",
        },
      }
    : image;
}

function commitNode(
  node: EditorRuntimeNodeV1,
  localId: string,
  reference: EditorArtifactReferenceV1,
): EditorRuntimeNodeV1 {
  if (node.kind === "image") {
    return {
      ...node,
      image: commitPlacedImage(node.image, localId, reference),
    };
  }
  if (node.kind === "frame") {
    return {
      ...node,
      ...(node.content
        ? {
            content: {
              image: commitPlacedImage(node.content.image, localId, reference),
            },
          }
        : {}),
    };
  }
  if (node.kind === "grid") {
    return {
      ...node,
      cells: node.cells.map((cell) => ({
        ...cell,
        ...(cell.content
          ? {
              content: {
                image: commitPlacedImage(
                  cell.content.image,
                  localId,
                  reference,
                ),
              },
            }
          : {}),
      })),
    };
  }
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map((child) =>
        commitNode(child, localId, reference),
      ),
    };
  }
  return node;
}

function markNodeImageFailed(
  node: EditorRuntimeNodeV1,
  localId: string,
): EditorRuntimeNodeV1 {
  if (node.kind === "image") {
    return {
      ...node,
      image: markPlacedImageFailed(node.image, localId),
    };
  }
  if (node.kind === "frame") {
    return {
      ...node,
      ...(node.content
        ? {
            content: {
              image: markPlacedImageFailed(node.content.image, localId),
            },
          }
        : {}),
    };
  }
  if (node.kind === "grid") {
    return {
      ...node,
      cells: node.cells.map((cell) => ({
        ...cell,
        ...(cell.content
          ? {
              content: {
                image: markPlacedImageFailed(cell.content.image, localId),
              },
            }
          : {}),
      })),
    };
  }
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map((child) =>
        markNodeImageFailed(child, localId),
      ),
    };
  }
  return node;
}

function restoreNodeImagePreview(
  node: EditorRuntimeNodeV1,
  localId: string,
  previewUrl: string,
): EditorRuntimeNodeV1 {
  if (node.kind === "image") {
    return {
      ...node,
      image: restorePlacedImagePreview(node.image, localId, previewUrl),
    };
  }
  if (node.kind === "frame") {
    return {
      ...node,
      ...(node.content
        ? {
            content: {
              image: restorePlacedImagePreview(
                node.content.image,
                localId,
                previewUrl,
              ),
            },
          }
        : {}),
    };
  }
  if (node.kind === "grid") {
    return {
      ...node,
      cells: node.cells.map((cell) => ({
        ...cell,
        ...(cell.content
          ? {
              content: {
                image: restorePlacedImagePreview(
                  cell.content.image,
                  localId,
                  previewUrl,
                ),
              },
            }
          : {}),
      })),
    };
  }
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map((child) =>
        restoreNodeImagePreview(child, localId, previewUrl),
      ),
    };
  }
  return node;
}

export function commitEditorLocalImageV1(
  document: EditorRuntimeDocumentV1,
  localId: string,
  reference: EditorArtifactReferenceV1,
): EditorRuntimeDocumentV1 {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      background:
        page.background.kind === "image"
          ? {
              ...page.background,
              image: commitPlacedImage(
                page.background.image,
                localId,
                reference,
              ),
            }
          : page.background,
      nodes: page.nodes.map((node) => commitNode(node, localId, reference)),
    })),
  };
}

export function markEditorLocalImageUploadFailedV1(
  document: EditorRuntimeDocumentV1,
  localId: string,
): EditorRuntimeDocumentV1 {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      background:
        page.background.kind === "image"
          ? {
              ...page.background,
              image: markPlacedImageFailed(page.background.image, localId),
            }
          : page.background,
      nodes: page.nodes.map((node) => markNodeImageFailed(node, localId)),
    })),
  };
}

export function restoreEditorLocalImagePreviewV1(
  document: EditorRuntimeDocumentV1,
  localId: string,
  previewUrl: string,
): EditorRuntimeDocumentV1 {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      background:
        page.background.kind === "image"
          ? {
              ...page.background,
              image: restorePlacedImagePreview(
                page.background.image,
                localId,
                previewUrl,
              ),
            }
          : page.background,
      nodes: page.nodes.map((node) =>
        restoreNodeImagePreview(node, localId, previewUrl),
      ),
    })),
  };
}
