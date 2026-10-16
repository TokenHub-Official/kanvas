import type {
  CanvasOperationSourceCompatibilityV1,
  CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";

export type CanvasOperationSurfaceV1 = "global_status" | "review" | "silent";

export type CanvasOperationReviewKindV1 =
  "completed" | "conflict" | "decision" | "recovery" | "terminal";

export type CanvasOperationReviewActionV1 =
  | "add_node"
  | "close"
  | "replace_content"
  | "retry"
  | "save_asset"
  | "set_background";

export interface CanvasOperationSurfaceProjectionV1 {
  readonly kind?: CanvasOperationReviewKindV1;
  readonly primaryAction?: CanvasOperationReviewActionV1;
  readonly surface: CanvasOperationSurfaceV1;
}

export function canvasOperationSurfaceProjectionV1(
  session: CanvasOperationSessionV1 | undefined,
  sourceCompatibility: CanvasOperationSourceCompatibilityV1 = "compatible",
): CanvasOperationSurfaceProjectionV1 {
  if (!session || session.phase === "discarded") {
    return { surface: "silent" };
  }
  if (session.phase === "starting" || session.phase === "running") {
    return { surface: "global_status" };
  }
  if (session.phase === "applied") {
    return {
      surface: "silent",
      kind: "completed",
    };
  }
  if (session.phase === "failed") {
    return session.failure?.retryable === false
      ? {
          surface: "review",
          kind: "terminal",
          primaryAction: "close",
        }
      : {
          surface: "review",
          kind: "recovery",
          primaryAction: "retry",
        };
  }
  if (session.phase === "cancelled") {
    return {
      surface: "review",
      kind: "terminal",
      primaryAction: "close",
    };
  }
  const conflict = session.phase === "conflict";
  const available = session.availableOutputDispositions;
  let primaryAction: CanvasOperationSurfaceProjectionV1["primaryAction"] =
    "save_asset";
  if (
    !conflict &&
    sourceCompatibility === "compatible" &&
    available.includes("replace_content")
  ) {
    primaryAction = "replace_content";
  } else if (available.includes("add_node")) {
    primaryAction = "add_node";
  } else if (available.includes("set_background")) {
    primaryAction = "set_background";
  }
  return {
    surface: "review",
    kind: conflict ? "conflict" : "decision",
    primaryAction,
  };
}

export function canvasOperationSurfaceV1(
  session: CanvasOperationSessionV1 | undefined,
): CanvasOperationSurfaceV1 {
  return canvasOperationSurfaceProjectionV1(session).surface;
}

export function canvasOperationReviewOpenV1(
  projection: CanvasOperationSurfaceProjectionV1,
  sessionId: string | undefined,
  dismissedSessionId: string | undefined,
): boolean {
  return (
    projection.surface === "review" &&
    Boolean(sessionId) &&
    sessionId !== dismissedSessionId
  );
}
