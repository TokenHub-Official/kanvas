import type { WorkflowPresentation } from "@kanvas/contracts/api";
import type { WorkflowAuthoringGraphV1 } from "@kanvas/contracts/workflow-authoring";

const recoveryPrefix = "kanvas:workflow-authoring-recovery:v1";

export interface WorkflowAuthoringRecovery {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly draftId: string;
  readonly baseDefinitionVersion: number;
  readonly baseDraftVersion: number;
  readonly displayName: string;
  readonly graph: WorkflowAuthoringGraphV1;
  readonly presentation: WorkflowPresentation;
  readonly savedAt: string;
}

export interface WorkflowAuthoringSaveSnapshot {
  readonly displayName: string;
  readonly graph: WorkflowAuthoringGraphV1;
  readonly presentation: WorkflowPresentation;
}

export interface WorkflowAuthoringSaveReconciliation {
  readonly clearRecovery: boolean;
  readonly dirty: boolean;
  readonly presentation: WorkflowPresentation;
}

function sameSnapshotValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileWorkflowAuthoringSave(
  submitted: WorkflowAuthoringSaveSnapshot,
  current: WorkflowAuthoringSaveSnapshot,
  savedPresentation: WorkflowPresentation,
): WorkflowAuthoringSaveReconciliation {
  const hasNewerLocalChanges =
    submitted.displayName !== current.displayName ||
    !sameSnapshotValue(submitted.graph, current.graph) ||
    !sameSnapshotValue(submitted.presentation, current.presentation);
  return Object.freeze({
    clearRecovery: !hasNewerLocalChanges,
    dirty: hasNewerLocalChanges,
    presentation: hasNewerLocalChanges
      ? current.presentation
      : savedPresentation,
  });
}

function storageKey(workspaceId: string, draftId: string): string {
  return `${recoveryPrefix}:${workspaceId}:${draftId}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function validField(value: unknown, output: boolean): boolean {
  const field = record(value);
  return (
    typeof field?.key === "string" &&
    typeof field.label === "string" &&
    typeof field.required === "boolean" &&
    Boolean(record(field.schema)) &&
    (!output || Boolean(record(field.binding)))
  );
}

function validNode(value: unknown): boolean {
  const node = record(value);
  if (
    typeof node?.id !== "string" ||
    typeof node.displayName !== "string" ||
    typeof node.type !== "string"
  ) {
    return false;
  }
  if (node.type === "input" || node.type === "output") {
    return (
      Boolean(record(node.schemaMetadata)) &&
      Array.isArray(node.fields) &&
      node.fields.every((field) => validField(field, node.type === "output"))
    );
  }
  if (typeof node.nodeKey !== "string") return false;
  if (node.type === "capability") {
    return Boolean(record(node.capability)) && Boolean(record(node.input));
  }
  if (node.type === "condition") {
    return (
      Boolean(record(node.value)) &&
      Array.isArray(node.cases) &&
      typeof node.defaultLabel === "string"
    );
  }
  if (node.type === "batch") {
    return (
      Boolean(record(node.capability)) &&
      Boolean(record(node.items)) &&
      Boolean(record(node.scopeKey)) &&
      Boolean(record(node.input)) &&
      typeof node.maxItems === "number" &&
      typeof node.maxConcurrency === "number"
    );
  }
  if (node.type === "approval") {
    return (
      Boolean(record(node.request)) && Boolean(record(node.decisionSchema))
    );
  }
  return false;
}

function validEdge(value: unknown): boolean {
  const edge = record(value);
  return (
    typeof edge?.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.sourcePort === "string" &&
    typeof edge.target === "string"
  );
}

function validRecovery(
  value: unknown,
  workspaceId: string,
  draftId: string,
): value is WorkflowAuthoringRecovery {
  const candidate = record(value);
  const graph = record(candidate?.graph);
  const presentation = record(candidate?.presentation);
  const availability = record(presentation?.availability);
  return (
    candidate?.schemaVersion === 1 &&
    candidate.workspaceId === workspaceId &&
    candidate.draftId === draftId &&
    typeof candidate.baseDefinitionVersion === "number" &&
    Number.isSafeInteger(candidate.baseDefinitionVersion) &&
    candidate.baseDefinitionVersion >= 1 &&
    typeof candidate.baseDraftVersion === "number" &&
    Number.isSafeInteger(candidate.baseDraftVersion) &&
    candidate.baseDraftVersion >= 1 &&
    typeof candidate.displayName === "string" &&
    typeof candidate.savedAt === "string" &&
    graph?.schemaVersion === 1 &&
    typeof graph.workflowKey === "string" &&
    Boolean(record(graph.limits)) &&
    Array.isArray(graph?.nodes) &&
    graph.nodes.every(validNode) &&
    Array.isArray(graph?.edges) &&
    graph.edges.every(validEdge) &&
    presentation?.schemaVersion === 1 &&
    Array.isArray(presentation.tags) &&
    presentation.tags.every((tag) => typeof tag === "string") &&
    typeof availability?.standalone === "boolean" &&
    typeof availability.canvas === "boolean" &&
    typeof availability.directLink === "boolean"
  );
}

export function readWorkflowAuthoringRecovery(
  workspaceId: string,
  draftId: string,
  storage:
    | Pick<Storage, "getItem" | "removeItem">
    | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): WorkflowAuthoringRecovery | undefined {
  if (!storage) return undefined;
  const key = storageKey(workspaceId, draftId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as unknown;
    if (validRecovery(value, workspaceId, draftId)) return value;
    try {
      storage.removeItem(key);
    } catch {
      return undefined;
    }
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Browser storage can be unavailable in restricted contexts.
    }
  }
  return undefined;
}

export function writeWorkflowAuthoringRecovery(
  value: WorkflowAuthoringRecovery,
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      storageKey(value.workspaceId, value.draftId),
      JSON.stringify(value),
    );
  } catch {
    // Navigation protection remains active if browser storage is unavailable.
  }
}

export function clearWorkflowAuthoringRecovery(
  workspaceId: string,
  draftId: string,
  storage: Pick<Storage, "removeItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): void {
  try {
    storage?.removeItem(storageKey(workspaceId, draftId));
  } catch {
    // The navigation guard still protects the in-memory draft.
  }
}
