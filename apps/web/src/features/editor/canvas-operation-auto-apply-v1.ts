import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";

export type CanvasOperationAutoApplyDecisionV1 =
  "apply" | "reconcile_applied" | "review";

export function canvasOperationReviewVisibleV1(
  session: CanvasOperationSessionV1 | undefined,
): boolean {
  return Boolean(
    session &&
    !(
      session.phase === "applied" &&
      session.completionBehavior === "auto_replace_safe"
    ),
  );
}

interface CanvasOperationAutoApplyDocumentV1 {
  readonly pages: readonly {
    readonly id: string;
    readonly nodes: readonly {
      readonly id: string;
      readonly kind: string;
      readonly locked: boolean;
      readonly image?: {
        readonly source: {
          readonly artifactId?: string;
          readonly kind: string;
        };
      };
    }[];
  }[];
}

export type CanvasOperationReplacementSafetyV1 =
  "forbidden" | "locked" | "missing" | "ready" | "source_changed";

function sourceNode(
  document: CanvasOperationAutoApplyDocumentV1,
  session: CanvasOperationSessionV1,
) {
  return document.pages
    .find((page) => page.id === session.source.pageId)
    ?.nodes.find((node) => node.id === session.source.nodeId);
}

export function canvasOperationReplacementSafetyV1(input: {
  readonly canEdit: boolean;
  readonly document: CanvasOperationAutoApplyDocumentV1;
  readonly expectedArtifactId: string;
  readonly session: CanvasOperationSessionV1;
}): CanvasOperationReplacementSafetyV1 {
  if (!input.canEdit) {
    return "forbidden";
  }
  const node = sourceNode(input.document, input.session);
  if (
    node?.kind !== "image" ||
    node.image?.source.kind !== "artifact" ||
    !node.image.source.artifactId
  ) {
    return "missing";
  }
  if (node.locked) {
    return "locked";
  }
  return node.image.source.artifactId === input.expectedArtifactId
    ? "ready"
    : "source_changed";
}

export function normalizeCanvasOperationAutoApplyRecoveryV1(input: {
  readonly conflictMessage: string;
  readonly document: CanvasOperationAutoApplyDocumentV1;
  readonly now?: Date;
  readonly session: CanvasOperationSessionV1;
}): CanvasOperationSessionV1 {
  const { session } = input;
  if (
    session.phase !== "applied" ||
    session.completionBehavior !== "auto_replace_safe" ||
    session.outputDisposition !== "replace_content" ||
    !session.previewArtifactId
  ) {
    return session;
  }
  const node = sourceNode(input.document, session);
  const currentArtifactId =
    node?.kind === "image" && node.image?.source.kind === "artifact"
      ? node.image.source.artifactId
      : undefined;
  if (currentArtifactId === session.previewArtifactId) {
    return session;
  }
  const updatedAt = (input.now ?? new Date()).toISOString();
  if (currentArtifactId === session.source.artifactId) {
    return Object.freeze({
      ...session,
      phase: "preview_ready",
      updatedAt,
    });
  }
  return Object.freeze({
    ...session,
    phase: "conflict",
    failure: Object.freeze({
      code: "canvas_operation_source_conflict",
      message: input.conflictMessage,
      retryable: false,
    }),
    updatedAt,
  });
}

export function canvasOperationAutoApplyDecisionV1(input: {
  readonly canEdit: boolean;
  readonly document: CanvasOperationAutoApplyDocumentV1;
  readonly previewUrlReady: boolean;
  readonly session: CanvasOperationSessionV1;
}): CanvasOperationAutoApplyDecisionV1 {
  const { session } = input;
  if (
    session.phase !== "preview_ready" ||
    session.completionBehavior !== "auto_replace_safe" ||
    session.outputDisposition !== "replace_content" ||
    session.cancelRequested ||
    !session.previewArtifactId
  ) {
    return "review";
  }
  const currentSourceNode = sourceNode(input.document, session);
  if (
    currentSourceNode?.kind !== "image" ||
    currentSourceNode.image?.source.kind !== "artifact" ||
    !currentSourceNode.image.source.artifactId
  ) {
    return "review";
  }
  if (currentSourceNode.image.source.artifactId === session.previewArtifactId) {
    return "reconcile_applied";
  }
  return input.previewUrlReady &&
    canvasOperationReplacementSafetyV1({
      canEdit: input.canEdit,
      document: input.document,
      expectedArtifactId: session.source.artifactId,
      session,
    }) === "ready"
    ? "apply"
    : "review";
}
