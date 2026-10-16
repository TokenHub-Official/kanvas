import type {
  CapabilityRunDetails,
  CurrentHumanContext,
} from "@kanvas/contracts/api";

import { httpStatus } from "../../api/http-status.js";
import type { CanvasOperationOutputMode } from "./canvas-operation-registry.js";
import {
  readCanvasToolArtifactId,
  type CanvasImageCapabilityTool,
  type CanvasToolCompletionBehaviorV1,
} from "./canvas-capability-tools.js";

export const canvasOperationSessionSchemaVersionV1 =
  "kanvas.canvas-operation-session/v1";
const MAX_OPERATION_PARAMETER_NODES = 1_000;
const MAX_OPERATION_PARAMETER_DEPTH = 16;
const MAX_OPERATION_FAILURE_MESSAGE_LENGTH = 600;
const MAX_OPERATION_LABEL_LENGTH = 240;
const MAX_OPERATION_RESULT_PATH_LENGTH = 12;
const MAX_OPERATION_RESULT_PATH_PART_LENGTH = 160;
const MAX_OPERATION_RESULT_PATH_INDEX = 10_000;
const MAX_OPERATION_FINGERPRINT_LENGTH = 2_000;
const MAX_OPERATION_COST_NOTICE_LENGTH = 240;

export type CanvasOperationSessionPhaseV1 =
  | "applied"
  | "cancelled"
  | "conflict"
  | "discarded"
  | "failed"
  | "preview_ready"
  | "running"
  | "starting";

export function isCanvasOperationFinalizationPhaseV1(
  phase: CanvasOperationSessionPhaseV1,
): boolean {
  return phase === "applied" || phase === "discarded";
}

export function canvasOperationBlocksNewRunV1(
  phase: CanvasOperationSessionPhaseV1,
): boolean {
  return (
    phase === "starting" ||
    phase === "running" ||
    phase === "preview_ready" ||
    phase === "conflict"
  );
}

export interface CanvasOperationSourceSnapshotV1 {
  readonly artifactId: string;
  readonly nodeFingerprint: string;
  readonly nodeId: string;
  readonly pageId: string;
}

export interface CanvasOperationFailureV1 {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface CanvasOperationSessionV1 {
  readonly assetAdoptionId?: string;
  readonly availableOutputDispositions: readonly CanvasOperationOutputMode[];
  readonly cancelRequested?: boolean;
  readonly completionBehavior: CanvasToolCompletionBehaviorV1;
  readonly createdAt: string;
  readonly costNotice?: string;
  readonly failure?: CanvasOperationFailureV1;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly label: string;
  readonly operationId: string;
  readonly outputDisposition: CanvasOperationOutputMode;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly phase: CanvasOperationSessionPhaseV1;
  readonly previewArtifactId?: string;
  readonly previewMaskArtifactId?: string;
  readonly resultArtifactPath: readonly (number | string)[];
  readonly resultMaskArtifactPath?: readonly (number | string)[];
  readonly schemaVersion: typeof canvasOperationSessionSchemaVersionV1;
  readonly source: CanvasOperationSourceSnapshotV1;
  readonly sourceParameterKey: string;
  readonly sourceValue: "artifact_id" | "artifact_reference";
  readonly savedAssetId?: string;
  readonly toolId: string;
  readonly updatedAt: string;
  readonly contractRevisionId: string;
  readonly capabilityRunId?: string;
  readonly workspaceId: string;
}

export type CanvasOperationSourceCompatibilityV1 =
  "compatible" | "missing" | "source_changed" | "wrong_page";

export interface CurrentCanvasOperationSourceV1 {
  readonly artifactId: string;
  readonly nodeId: string;
  readonly pageId: string;
}

export function currentCanvasOperationSourceV1(
  document: {
    readonly pages: readonly {
      readonly id: string;
      readonly nodes: readonly {
        readonly id: string;
        readonly kind: string;
        readonly image?: {
          readonly source: {
            readonly artifactId?: string;
            readonly kind: string;
          };
        };
      }[];
    }[];
  },
  session: CanvasOperationSessionV1,
): CurrentCanvasOperationSourceV1 | undefined {
  const page = document.pages.find((candidate) =>
    candidate.nodes.some((node) => node.id === session.source.nodeId),
  );
  const node = page?.nodes.find(
    (candidate) => candidate.id === session.source.nodeId,
  );
  return node?.kind === "image" &&
    node.image?.source.kind === "artifact" &&
    node.image.source.artifactId
    ? {
        pageId: page!.id,
        nodeId: node.id,
        artifactId: node.image.source.artifactId,
      }
    : undefined;
}

export function canvasOperationApplicationAuthorizedV1(
  context: CurrentHumanContext,
  workspaceId: string,
): boolean {
  const workspace = context.workspaces.find(
    (candidate) => candidate.id === workspaceId,
  );
  return Boolean(
    workspace?.permissions.includes("canvas.write") &&
    workspace.permissions.includes("asset.write") &&
    workspace.permissions.includes("artifact.download"),
  );
}

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const operationIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const terminalPhases = new Set<CanvasOperationSessionPhaseV1>([
  "applied",
  "discarded",
]);
const phases = new Set<CanvasOperationSessionPhaseV1>([
  "applied",
  "cancelled",
  "conflict",
  "discarded",
  "failed",
  "preview_ready",
  "running",
  "starting",
]);
const outputModes = new Set<CanvasOperationOutputMode>([
  "add_node",
  "asset_only",
  "fill_container",
  "replace_content",
  "set_background",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function operationParameters(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const active = new WeakSet<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (
      nodes > MAX_OPERATION_PARAMETER_NODES ||
      depth > MAX_OPERATION_PARAMETER_DEPTH
    ) {
      throw new RangeError(
        "Canvas operation parameters exceed bounded JSON limits.",
      );
    }
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      return item;
    }
    if (!item || typeof item !== "object") {
      throw new TypeError(
        "Canvas operation parameters must contain JSON values.",
      );
    }
    if (active.has(item)) {
      throw new TypeError("Canvas operation parameters cannot contain cycles.");
    }
    active.add(item);
    try {
      if (Array.isArray(item)) {
        return Object.freeze(item.map((entry) => visit(entry, depth + 1)));
      }
      return Object.freeze(
        Object.fromEntries(
          Object.entries(item).map(([key, entry]) => {
            assertStableIdentity(key, "Canvas operation parameter key");
            return [key, visit(entry, depth + 1)];
          }),
        ),
      );
    } finally {
      active.delete(item);
    }
  };
  return visit(value, 0) as Readonly<Record<string, unknown>>;
}

function timestamp(now: Date): string {
  return now.toISOString();
}

function assertStableIdentity(value: string, label: string): void {
  if (!operationIdentityPattern.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function assertUlid(value: string, label: string): void {
  if (!ulidPattern.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function assertMutable(session: CanvasOperationSessionV1): void {
  if (terminalPhases.has(session.phase)) {
    throw new Error(
      `Canvas operation ${session.id} is already ${session.phase}.`,
    );
  }
}

function validatedFailure(
  failure: CanvasOperationFailureV1,
): CanvasOperationFailureV1 {
  if (
    !operationIdentityPattern.test(failure.code) ||
    failure.message.trim().length === 0 ||
    failure.message.length > MAX_OPERATION_FAILURE_MESSAGE_LENGTH
  ) {
    throw new TypeError(
      "Canvas operation failure code and message are invalid.",
    );
  }
  return Object.freeze({ ...failure });
}

function withoutFailure(
  session: CanvasOperationSessionV1,
): CanvasOperationSessionV1 {
  const value = { ...session };
  delete value.failure;
  return value;
}

export function canvasOperationNodeFingerprintV1(input: {
  readonly artifactId: string;
  readonly nodeId: string;
  readonly pageId: string;
}): string {
  return JSON.stringify({
    artifactId: input.artifactId,
    nodeId: input.nodeId,
    pageId: input.pageId,
  });
}

export function createCanvasOperationSessionV1(input: {
  readonly assetAdoptionId?: string;
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly now?: Date;
  readonly outputDisposition: CanvasOperationOutputMode;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly source: Omit<CanvasOperationSourceSnapshotV1, "nodeFingerprint"> & {
    readonly nodeFingerprint?: string;
  };
  readonly tool: CanvasImageCapabilityTool;
  readonly workspaceId: string;
}): CanvasOperationSessionV1 {
  const now = input.now ?? new Date();
  const id = input.id ?? crypto.randomUUID();
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  assertStableIdentity(id, "Canvas operation session identity");
  assertStableIdentity(idempotencyKey, "Canvas operation idempotency key");
  assertUlid(input.workspaceId, "Canvas operation Workspace");
  if (input.assetAdoptionId) {
    assertUlid(input.assetAdoptionId, "Canvas operation result Asset");
  }
  assertUlid(input.source.artifactId, "Canvas operation source Artifact");
  assertStableIdentity(input.source.nodeId, "Canvas operation source Node");
  assertStableIdentity(input.source.pageId, "Canvas operation source Page");
  if (!input.tool.outputModes.includes(input.outputDisposition)) {
    throw new TypeError(
      `Canvas operation ${input.tool.operationId} does not support ${input.outputDisposition}.`,
    );
  }
  const value: CanvasOperationSessionV1 = {
    schemaVersion: canvasOperationSessionSchemaVersionV1,
    id,
    ...(input.assetAdoptionId
      ? { assetAdoptionId: input.assetAdoptionId }
      : {}),
    workspaceId: input.workspaceId,
    completionBehavior: input.tool.completionBehavior,
    operationId: input.tool.operationId,
    toolId: input.tool.id,
    label: input.tool.label,
    contractRevisionId: input.tool.contractRevisionId,
    resultArtifactPath: input.tool.outputArtifactPath,
    ...(input.tool.maskArtifactPath
      ? {
          resultMaskArtifactPath: input.tool.maskArtifactPath,
        }
      : {}),
    availableOutputDispositions: input.tool.outputModes,
    sourceParameterKey: input.tool.sourceParameterKey,
    sourceValue: input.tool.sourceValue,
    source: {
      ...input.source,
      nodeFingerprint:
        input.source.nodeFingerprint ??
        canvasOperationNodeFingerprintV1(input.source),
    },
    parameters: operationParameters(input.parameters ?? {}),
    outputDisposition: input.outputDisposition,
    idempotencyKey,
    phase: "starting",
    createdAt: timestamp(now),
    updatedAt: timestamp(now),
  };
  return Object.freeze(value);
}

export function isCanvasOperationSessionV1(
  value: unknown,
): value is CanvasOperationSessionV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== canvasOperationSessionSchemaVersionV1 ||
    typeof value.id !== "string" ||
    !operationIdentityPattern.test(value.id) ||
    typeof value.workspaceId !== "string" ||
    !ulidPattern.test(value.workspaceId) ||
    typeof value.operationId !== "string" ||
    !operationIdentityPattern.test(value.operationId) ||
    typeof value.toolId !== "string" ||
    !operationIdentityPattern.test(value.toolId) ||
    typeof value.label !== "string" ||
    value.label.length === 0 ||
    value.label.length > MAX_OPERATION_LABEL_LENGTH ||
    typeof value.contractRevisionId !== "string" ||
    !ulidPattern.test(value.contractRevisionId) ||
    typeof value.sourceParameterKey !== "string" ||
    !operationIdentityPattern.test(value.sourceParameterKey) ||
    (value.sourceValue !== "artifact_id" &&
      value.sourceValue !== "artifact_reference") ||
    typeof value.idempotencyKey !== "string" ||
    !operationIdentityPattern.test(value.idempotencyKey) ||
    (value.completionBehavior !== "review_required" &&
      value.completionBehavior !== "auto_replace_safe") ||
    typeof value.phase !== "string" ||
    !phases.has(value.phase as CanvasOperationSessionPhaseV1) ||
    typeof value.outputDisposition !== "string" ||
    !outputModes.has(value.outputDisposition as CanvasOperationOutputMode) ||
    !Array.isArray(value.availableOutputDispositions) ||
    value.availableOutputDispositions.length === 0 ||
    value.availableOutputDispositions.some(
      (mode) =>
        typeof mode !== "string" ||
        !outputModes.has(mode as CanvasOperationOutputMode),
    ) ||
    !value.availableOutputDispositions.includes(value.outputDisposition) ||
    !Array.isArray(value.resultArtifactPath) ||
    value.resultArtifactPath.length === 0 ||
    value.resultArtifactPath.length > MAX_OPERATION_RESULT_PATH_LENGTH ||
    value.resultArtifactPath.some(
      (part) =>
        !(
          (typeof part === "string" &&
            part.length > 0 &&
            part.length <= MAX_OPERATION_RESULT_PATH_PART_LENGTH) ||
          (typeof part === "number" &&
            Number.isSafeInteger(part) &&
            part >= 0 &&
            part <= MAX_OPERATION_RESULT_PATH_INDEX)
        ),
    ) ||
    !isRecord(value.parameters) ||
    !isRecord(value.source) ||
    typeof value.source.pageId !== "string" ||
    !operationIdentityPattern.test(value.source.pageId) ||
    typeof value.source.nodeId !== "string" ||
    !operationIdentityPattern.test(value.source.nodeId) ||
    typeof value.source.artifactId !== "string" ||
    !ulidPattern.test(value.source.artifactId) ||
    typeof value.source.nodeFingerprint !== "string" ||
    value.source.nodeFingerprint.length === 0 ||
    value.source.nodeFingerprint.length > MAX_OPERATION_FINGERPRINT_LENGTH ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return false;
  }
  if (
    value.assetAdoptionId !== undefined &&
    (typeof value.assetAdoptionId !== "string" ||
      !ulidPattern.test(value.assetAdoptionId))
  ) {
    return false;
  }
  if (
    value.cancelRequested !== undefined &&
    typeof value.cancelRequested !== "boolean"
  ) {
    return false;
  }
  if (
    value.savedAssetId !== undefined &&
    (typeof value.savedAssetId !== "string" ||
      !ulidPattern.test(value.savedAssetId) ||
      (value.assetAdoptionId !== undefined &&
        value.savedAssetId !== value.assetAdoptionId))
  ) {
    return false;
  }
  if (
    value.costNotice !== undefined &&
    (typeof value.costNotice !== "string" ||
      value.costNotice.length === 0 ||
      value.costNotice.length > MAX_OPERATION_COST_NOTICE_LENGTH)
  ) {
    return false;
  }
  if (
    value.capabilityRunId !== undefined &&
    (typeof value.capabilityRunId !== "string" ||
      !ulidPattern.test(value.capabilityRunId))
  ) {
    return false;
  }
  if (
    value.previewArtifactId !== undefined &&
    (typeof value.previewArtifactId !== "string" ||
      !ulidPattern.test(value.previewArtifactId))
  ) {
    return false;
  }
  if (
    value.previewMaskArtifactId !== undefined &&
    (typeof value.previewMaskArtifactId !== "string" ||
      !ulidPattern.test(value.previewMaskArtifactId))
  ) {
    return false;
  }
  if (
    value.resultMaskArtifactPath !== undefined &&
    (!Array.isArray(value.resultMaskArtifactPath) ||
      value.resultMaskArtifactPath.length === 0 ||
      value.resultMaskArtifactPath.length > MAX_OPERATION_RESULT_PATH_LENGTH ||
      value.resultMaskArtifactPath.some(
        (part) =>
          !(
            (typeof part === "string" &&
              part.length > 0 &&
              part.length <= MAX_OPERATION_RESULT_PATH_PART_LENGTH) ||
            (typeof part === "number" &&
              Number.isSafeInteger(part) &&
              part >= 0 &&
              part <= MAX_OPERATION_RESULT_PATH_INDEX)
          ),
      ))
  ) {
    return false;
  }
  if (
    value.failure !== undefined &&
    (!isRecord(value.failure) ||
      typeof value.failure.code !== "string" ||
      !operationIdentityPattern.test(value.failure.code) ||
      typeof value.failure.message !== "string" ||
      value.failure.message.trim().length === 0 ||
      value.failure.message.length > MAX_OPERATION_FAILURE_MESSAGE_LENGTH ||
      typeof value.failure.retryable !== "boolean")
  ) {
    return false;
  }
  try {
    operationParameters(value.parameters);
  } catch {
    return false;
  }
  return true;
}

export function normalizeCanvasOperationSessionV1(
  value: unknown,
): CanvasOperationSessionV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate =
    value.completionBehavior === "review_required" ||
    value.completionBehavior === "auto_replace_safe"
      ? value
      : {
          ...value,
          completionBehavior: "review_required",
        };
  return isCanvasOperationSessionV1(candidate)
    ? Object.freeze(candidate)
    : undefined;
}

export function chooseCanvasOperationOutputDispositionV1(
  session: CanvasOperationSessionV1,
  outputDisposition: CanvasOperationOutputMode,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (
    session.phase !== "preview_ready" &&
    session.phase !== "conflict" &&
    session.phase !== "starting"
  ) {
    throw new Error(
      `Canvas operation ${session.id} has no result whose output disposition can change.`,
    );
  }
  if (!session.availableOutputDispositions.includes(outputDisposition)) {
    throw new TypeError(
      `Canvas operation ${session.operationId} does not support ${outputDisposition}.`,
    );
  }
  return Object.freeze({
    ...withoutFailure(session),
    outputDisposition,
    phase: session.phase === "conflict" ? "preview_ready" : session.phase,
    updatedAt: timestamp(now),
  });
}

export function markCanvasOperationRunningV1(
  session: CanvasOperationSessionV1,
  capabilityRunId: string,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  assertUlid(capabilityRunId, "Canvas operation Capability Run");
  if (session.capabilityRunId && session.capabilityRunId !== capabilityRunId) {
    throw new Error(
      `Canvas operation ${session.id} is already bound to another Workflow Run.`,
    );
  }
  return Object.freeze({
    ...session,
    capabilityRunId,
    phase: "running",
    updatedAt: timestamp(now),
  });
}

export function retryCanvasOperationStartV1(
  session: CanvasOperationSessionV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (
    session.phase !== "failed" ||
    session.capabilityRunId ||
    session.failure?.code !== "canvas_operation_start_failed"
  ) {
    throw new Error(
      `Canvas operation ${session.id} is not a replayable start failure.`,
    );
  }
  const retrying = { ...session };
  delete retrying.failure;
  return Object.freeze({
    ...retrying,
    phase: "starting",
    updatedAt: timestamp(now),
  });
}

export function requestCanvasOperationCancellationV1(
  session: CanvasOperationSessionV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (session.phase !== "starting" && session.phase !== "running") {
    throw new Error(
      `Canvas operation ${session.id} cannot be cancelled from phase ${session.phase}.`,
    );
  }
  return Object.freeze({
    ...session,
    cancelRequested: true,
    updatedAt: timestamp(now),
  });
}

export function canvasOperationStartFailureMessageV1(
  error: unknown,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const networkFailure =
    !online ||
    status === 0 ||
    (error instanceof TypeError &&
      error.message.toLocaleLowerCase("en-US") === "failed to fetch");
  if (status === httpStatus.forbidden) {
    return "当前权限已变化，无法启动处理。请联系 Workspace 管理员恢复制作权限后重试。";
  }
  if (networkFailure) {
    return "启动结果暂时无法确认。任务可能已经开始；请重试以恢复同一处理任务。";
  }
  return "暂时无法启动处理。请稍后重试。";
}

export function canvasOperationStatusFailureMessageV1(
  error: unknown,
  source: "run" | "timeline",
  translate?: (key: string) => string,
): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  if (status === httpStatus.forbidden) {
    return (
      translate?.("canvas.operationStatus.errors.forbidden") ??
      "当前权限已变化，无法继续读取处理进度。后台任务可能仍在继续；恢复权限后可重新连接。"
    );
  }
  return source === "run"
    ? (translate?.("canvas.operationStatus.errors.runUnavailable") ??
        "暂时无法确认处理进度。任务可能仍在后台继续，请重新连接。")
    : (translate?.("canvas.operationStatus.errors.timelineUnavailable") ??
        "处理仍在继续，但暂时无法读取执行位置与回退信息。");
}

export function canvasOperationMessageAfterRunReconcileV1(
  current: string | undefined,
  phase: CanvasOperationSessionPhaseV1,
): string | undefined {
  if (!current || !["cancelled", "failed", "preview_ready"].includes(phase)) {
    return current;
  }
  return [
    "已记录取消请求。",
    "取消请求已在当前页面记录，",
    "取消请求的结果暂时无法确认。",
    "原图片已删除，正在请求停止后台处理；",
    "已自动切换到云端继续处理。",
  ].some((prefix) => current.startsWith(prefix))
    ? undefined
    : current;
}

export function reconcileCanvasOperationRunV1(
  session: CanvasOperationSessionV1,
  run: CapabilityRunDetails,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (!session.capabilityRunId || run.id !== session.capabilityRunId) {
    throw new Error(
      `Capability Run does not belong to Canvas operation ${session.id}.`,
    );
  }
  if (run.lifecycleStatus === "cancelled") {
    return Object.freeze({
      ...session,
      phase: "cancelled",
      updatedAt: timestamp(now),
    });
  }
  if (run.lifecycleStatus === "failed") {
    return Object.freeze({
      ...session,
      phase: "failed",
      failure: {
        code: "capability_run_failed",
        message: `${session.label}未能完成。`,
        retryable: true,
      },
      updatedAt: timestamp(now),
    });
  }
  if (run.lifecycleStatus !== "completed") {
    return Object.freeze({
      ...session,
      phase: "running",
      updatedAt: timestamp(now),
    });
  }
  const artifactId = readCanvasToolArtifactId(
    run.output,
    session.resultArtifactPath,
  );
  const maskArtifactId = session.resultMaskArtifactPath
    ? readCanvasToolArtifactId(run.output, session.resultMaskArtifactPath)
    : undefined;
  if (!artifactId) {
    return Object.freeze({
      ...session,
      phase: "failed",
      failure: {
        code: "canvas_operation_result_missing",
        message: `${session.label}没有返回可用图片。`,
        retryable: false,
      },
      updatedAt: timestamp(now),
    });
  }
  return Object.freeze({
    ...session,
    phase: "preview_ready",
    previewArtifactId: artifactId,
    ...(maskArtifactId ? { previewMaskArtifactId: maskArtifactId } : {}),
    updatedAt: timestamp(now),
  });
}

export function canvasOperationSourceCompatibilityV1(
  session: CanvasOperationSessionV1,
  current: CurrentCanvasOperationSourceV1 | undefined,
): CanvasOperationSourceCompatibilityV1 {
  if (!current || current.nodeId !== session.source.nodeId) {
    return "missing";
  }
  if (current.pageId !== session.source.pageId) {
    return "wrong_page";
  }
  return current.artifactId === session.source.artifactId
    ? "compatible"
    : "source_changed";
}

export function canvasOperationSessionRecoverableV1(
  session: CanvasOperationSessionV1,
): boolean {
  return session.phase !== "discarded" && session.phase !== "cancelled";
}

export function markCanvasOperationConflictV1(
  session: CanvasOperationSessionV1,
  message: string,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (!message.trim()) {
    throw new TypeError("Canvas operation conflict message is required.");
  }
  return Object.freeze({
    ...session,
    phase: "conflict",
    failure: {
      code: "canvas_operation_source_conflict",
      message,
      retryable: false,
    },
    updatedAt: timestamp(now),
  });
}

export function markCanvasOperationFailedV1(
  session: CanvasOperationSessionV1,
  failure: CanvasOperationFailureV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  return Object.freeze({
    ...session,
    phase: "failed",
    failure: validatedFailure(failure),
    updatedAt: timestamp(now),
  });
}

export function canvasOperationApplyFailureV1(
  error: unknown,
): CanvasOperationFailureV1 {
  const status =
    isRecord(error) && typeof error.status === "number"
      ? error.status
      : undefined;
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  if (status === httpStatus.forbidden) {
    return {
      code: "canvas_operation_apply_forbidden",
      message:
        "当前编辑权限已变化，结果没有应用。恢复编辑权限后可继续使用同一候选，无需重新处理。",
      retryable: true,
    };
  }
  if (
    code === "canvas_operation_result_invalid" ||
    status === httpStatus.notFound
  ) {
    return {
      code: "canvas_operation_result_invalid",
      message:
        "处理结果已无法安全应用到画板。原图没有变化，可关闭这个候选后重新处理。",
      retryable: false,
    };
  }
  return {
    code: "canvas_operation_apply_check_failed",
    message:
      "暂时无法完成应用前检查，结果没有应用。候选仍会保留，可直接重试应用。",
    retryable: true,
  };
}

export function markCanvasOperationApplyFailedV1(
  session: CanvasOperationSessionV1,
  failure: CanvasOperationFailureV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (
    (session.phase !== "preview_ready" && session.phase !== "conflict") ||
    !session.previewArtifactId
  ) {
    throw new Error(
      `Canvas operation ${session.id} has no candidate whose Apply can be retried.`,
    );
  }
  return Object.freeze({
    ...session,
    phase: "preview_ready",
    failure: validatedFailure(failure),
    updatedAt: timestamp(now),
  });
}

export function markCanvasOperationAppliedV1(
  session: CanvasOperationSessionV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  if (session.phase !== "preview_ready" || !session.previewArtifactId) {
    throw new Error(
      `Canvas operation ${session.id} has no preview result to apply.`,
    );
  }
  return Object.freeze({
    ...withoutFailure(session),
    phase: "applied",
    updatedAt: timestamp(now),
  });
}

export function pinCanvasOperationAssetAdoptionV1(
  session: CanvasOperationSessionV1,
  assetId: string,
  now = new Date(),
): CanvasOperationSessionV1 {
  if (session.phase !== "preview_ready" && session.phase !== "applied") {
    throw new Error(
      `Canvas operation ${session.id} cannot save an Asset from phase ${session.phase}.`,
    );
  }
  assertUlid(assetId, "Canvas operation result Asset");
  if (session.assetAdoptionId && session.assetAdoptionId !== assetId) {
    throw new Error(
      `Canvas operation ${session.id} already pins another result Asset.`,
    );
  }
  return Object.freeze({
    ...session,
    assetAdoptionId: assetId,
    updatedAt: timestamp(now),
  });
}

export function markCanvasOperationAssetSavedV1(
  session: CanvasOperationSessionV1,
  assetId: string,
  now = new Date(),
): CanvasOperationSessionV1 {
  if (
    (session.phase !== "preview_ready" && session.phase !== "applied") ||
    session.assetAdoptionId !== assetId
  ) {
    throw new Error(
      `Canvas operation ${session.id} does not pin result Asset ${assetId}.`,
    );
  }
  return Object.freeze({
    ...session,
    savedAssetId: assetId,
    updatedAt: timestamp(now),
  });
}

export function markCanvasOperationDiscardedV1(
  session: CanvasOperationSessionV1,
  now = new Date(),
): CanvasOperationSessionV1 {
  assertMutable(session);
  return Object.freeze({
    ...session,
    phase: "discarded",
    updatedAt: timestamp(now),
  });
}
