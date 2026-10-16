import type { AgentComposerReference } from "./agent-composer-reference-picker.js";

export interface AgentComposerDraftContext {
  readonly references: readonly AgentComposerReference[];
  readonly agentDefinitionId?: string;
  readonly entrySkillRemoved?: boolean;
  readonly entrySkillRevisionId?: string;
  readonly entryBrandRevisionId?: string;
  readonly entryBrandRemoved?: boolean;
  readonly brandCleared?: boolean;
}

export interface AgentComposerSubmissionAttempt {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

function submissionStorageKey(key: string): string {
  return `${key}:submission`;
}

export function readAgentComposerSubmission(
  key: string,
): AgentComposerSubmissionAttempt | undefined {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(submissionStorageKey(key)) ?? "null",
    );
    if (!value || typeof value !== "object") return undefined;
    const attempt = value as Record<string, unknown>;
    if (
      typeof attempt.fingerprint !== "string" ||
      typeof attempt.idempotencyKey !== "string" ||
      !attempt.idempotencyKey.startsWith("agent-message:")
    ) {
      return undefined;
    }
    return {
      fingerprint: attempt.fingerprint,
      idempotencyKey: attempt.idempotencyKey,
    };
  } catch {
    return undefined;
  }
}

export function agentComposerSubmissionAttempt(
  current: AgentComposerSubmissionAttempt | undefined,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID(),
): AgentComposerSubmissionAttempt {
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    idempotencyKey: `agent-message:${createId()}`,
  };
}

export function persistAgentComposerSubmission(
  key: string,
  attempt: AgentComposerSubmissionAttempt,
): void {
  try {
    sessionStorage.setItem(submissionStorageKey(key), JSON.stringify(attempt));
  } catch {
    /* The in-memory attempt still protects retries in the current page. */
  }
}

export function clearAgentComposerSubmission(
  key: string,
  idempotencyKey: string,
): void {
  try {
    const current = readAgentComposerSubmission(key);
    if (!current || current.idempotencyKey === idempotencyKey) {
      sessionStorage.removeItem(submissionStorageKey(key));
    }
  } catch {
    /* The caller also clears its in-memory attempt. */
  }
}

function isReference(value: unknown): value is AgentComposerReference {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.title !== "string")
    return false;
  switch (item.kind) {
    case "library":
      return typeof item.libraryId === "string";
    case "artifact":
      return typeof item.artifactId === "string";
    case "skill":
      return typeof item.skillRevisionId === "string";
    case "brand":
      return (
        typeof item.brandKitId === "string" &&
        typeof item.brandKitRevisionId === "string"
      );
    case "asset":
      return (
        typeof item.assetId === "string" && typeof item.artifactId === "string"
      );
    case "canvas":
      return (
        typeof item.resourceId === "string" &&
        Number.isSafeInteger(item.version)
      );
    case "workflow":
      return typeof item.resourceId === "string";
    default:
      return false;
  }
}

export function readAgentDraftContext(key: string): AgentComposerDraftContext {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(`${key}:context`) ?? "null",
    );
    if (!value || typeof value !== "object") return { references: [] };
    const draft = value as Record<string, unknown>;
    return {
      references: Array.isArray(draft.references)
        ? draft.references.filter(isReference)
        : [],
      ...(typeof draft.agentDefinitionId === "string"
        ? { agentDefinitionId: draft.agentDefinitionId }
        : {}),
      ...(typeof draft.entrySkillRevisionId === "string"
        ? { entrySkillRevisionId: draft.entrySkillRevisionId }
        : {}),
      ...(typeof draft.entryBrandRevisionId === "string"
        ? { entryBrandRevisionId: draft.entryBrandRevisionId }
        : {}),
      entrySkillRemoved: draft.entrySkillRemoved === true,
      entryBrandRemoved: draft.entryBrandRemoved === true,
      brandCleared: draft.brandCleared === true,
    };
  } catch {
    return { references: [] };
  }
}

export function persistAgentDraftContext(
  key: string,
  value: AgentComposerDraftContext,
): void {
  try {
    sessionStorage.setItem(`${key}:context`, JSON.stringify(value));
  } catch {
    /* The current draft remains editable if tab storage is unavailable. */
  }
}

export function composerDraftStorageKey(
  workspaceId: string,
  threadId: string | undefined,
  draftId?: string,
): string {
  return `kanvas:agent-composer:${workspaceId}:${threadId ?? (draftId ? `new:${draftId}` : "new")}`;
}
