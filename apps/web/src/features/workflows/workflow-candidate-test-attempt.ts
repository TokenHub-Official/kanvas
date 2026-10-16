const attemptPrefix = "kanvas:workflow-candidate-test-attempt:v1";

export interface WorkflowCandidateTestAttempt {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly inputFingerprint: string;
  readonly idempotencyKey: string;
  readonly runId?: string;
}

function storageKey(workspaceId: string, candidateId: string): string {
  return `${attemptPrefix}:${workspaceId}:${candidateId}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function workflowCandidateTestInputFingerprint(input: unknown): string {
  return JSON.stringify(stableValue(input)) ?? "undefined";
}

export function readWorkflowCandidateTestAttempt(
  workspaceId: string,
  candidateId: string,
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): WorkflowCandidateTestAttempt | undefined {
  if (!storage) return undefined;
  try {
    const value = JSON.parse(
      storage.getItem(storageKey(workspaceId, candidateId)) ?? "null",
    ) as Partial<WorkflowCandidateTestAttempt> | null;
    if (
      value?.schemaVersion === 1 &&
      value.candidateId === candidateId &&
      typeof value.inputFingerprint === "string" &&
      typeof value.idempotencyKey === "string" &&
      (value.runId === undefined || typeof value.runId === "string")
    ) {
      return value as WorkflowCandidateTestAttempt;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function prepareWorkflowCandidateTestAttempt(
  options: {
    readonly workspaceId: string;
    readonly candidateId: string;
    readonly input: unknown;
    readonly createId: () => string;
    readonly forceNew?: boolean;
  },
  storage:
    Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): WorkflowCandidateTestAttempt {
  const fingerprint = workflowCandidateTestInputFingerprint(options.input);
  const existing = readWorkflowCandidateTestAttempt(
    options.workspaceId,
    options.candidateId,
    storage,
  );
  if (
    !options.forceNew &&
    existing?.inputFingerprint === fingerprint &&
    !existing.runId
  ) {
    return existing;
  }
  const next: WorkflowCandidateTestAttempt = {
    schemaVersion: 1,
    candidateId: options.candidateId,
    inputFingerprint: fingerprint,
    idempotencyKey: options.createId(),
  };
  try {
    storage?.setItem(
      storageKey(options.workspaceId, options.candidateId),
      JSON.stringify(next),
    );
  } catch {
    // Server idempotency still applies for this mounted panel.
  }
  return next;
}

export function acceptWorkflowCandidateTestAttempt(
  workspaceId: string,
  attempt: WorkflowCandidateTestAttempt,
  runId: string,
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): WorkflowCandidateTestAttempt {
  const accepted = { ...attempt, runId };
  try {
    storage?.setItem(
      storageKey(workspaceId, attempt.candidateId),
      JSON.stringify(accepted),
    );
  } catch {
    // The Candidate review remains the durable recovery source.
  }
  return accepted;
}
