import { safeReturnTo } from "../../auth/entry-recovery.js";

const MAX_SELECTED_ELEMENT_KEYS = 200;
const MAX_SKILL_TEST_REQUEST_LENGTH = 2_000;
const maxAgentLinkPromptLength = 8_000;
const elementKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export interface AgentEntryDraftSearch {
  readonly invalidAgentSelection?: boolean;
  readonly invalidInitialPrompt?: boolean;
  readonly draftId?: string;
  readonly brandKitRevisionId?: string;
  readonly agentDefinitionId?: string;
  readonly skillCandidateId?: string;
  readonly skillRevisionId?: string;
  readonly initialPrompt?: string;
  readonly canvasDraftId?: string;
}

export function agentEntryNeedsFreshDraft(
  search: AgentEntryDraftSearch,
): boolean {
  return (
    !search.draftId &&
    Boolean(
      search.agentDefinitionId ||
      search.initialPrompt ||
      search.invalidAgentSelection ||
      search.invalidInitialPrompt ||
      search.skillCandidateId ||
      search.skillRevisionId ||
      search.brandKitRevisionId ||
      search.canvasDraftId,
    )
  );
}

export function prepareAgentEntryDraft<TSearch extends AgentEntryDraftSearch>(
  search: TSearch,
  draftId: string,
) {
  if (!agentEntryNeedsFreshDraft(search)) return undefined;
  const { initialPrompt, ...entrySearch } = search;
  return Object.freeze({
    ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    search: Object.freeze({ ...entrySearch, draftId }),
  });
}

export function agentSelectedElementKeys(value: unknown): readonly string[] {
  let candidates: unknown[] = [];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      candidates = Array.isArray(parsed) ? parsed : value.split(",");
    } catch {
      candidates = value.split(",");
    }
  }
  return [...new Set(candidates)]
    .filter(
      (key): key is string =>
        typeof key === "string" && elementKeyPattern.test(key),
    )
    .slice(0, MAX_SELECTED_ELEMENT_KEYS);
}

export function validateAgentCanvasSearch(search: Record<string, unknown>) {
  const brandKitId =
    typeof search.brandKitId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.brandKitId)
      ? search.brandKitId
      : undefined;
  const brandKitRevisionId =
    typeof search.brandKitRevisionId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.brandKitRevisionId)
      ? search.brandKitRevisionId
      : undefined;
  const agentDefinitionId =
    typeof search.agentDefinitionId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.agentDefinitionId)
      ? search.agentDefinitionId
      : undefined;
  const skillCandidateId =
    typeof search.skillCandidateId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.skillCandidateId)
      ? search.skillCandidateId
      : undefined;
  const skillRevisionId =
    typeof search.skillRevisionId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.skillRevisionId)
      ? search.skillRevisionId
      : undefined;
  const skillCandidateDigest =
    typeof search.skillCandidateDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(search.skillCandidateDigest)
      ? search.skillCandidateDigest
      : undefined;
  const skillTestRequest =
    typeof search.skillTestRequest === "string" &&
    search.skillTestRequest.trim().length > 0 &&
    search.skillTestRequest.length <= MAX_SKILL_TEST_REQUEST_LENGTH
      ? search.skillTestRequest
      : undefined;
  const initialPrompt =
    typeof search.initialPrompt === "string" &&
    search.initialPrompt.trim().length > 0 &&
    search.initialPrompt.length <= maxAgentLinkPromptLength
      ? search.initialPrompt
      : undefined;
  const returnTo = safeReturnTo(search.returnTo);
  const base = {
    ...(search.invalidAgentSelection === true ||
    (search.agentDefinitionId !== undefined && !agentDefinitionId)
      ? { invalidAgentSelection: true }
      : {}),
    ...(search.invalidInitialPrompt === true ||
    (search.initialPrompt !== undefined &&
      (typeof search.initialPrompt !== "string" ||
        search.initialPrompt.length > maxAgentLinkPromptLength))
      ? { invalidInitialPrompt: true }
      : {}),
    ...(typeof search.draftId === "string" &&
    /^[0-9a-f-]{36}$/u.test(search.draftId)
      ? { draftId: search.draftId }
      : {}),
    ...(brandKitId && brandKitRevisionId
      ? { brandKitId, brandKitRevisionId }
      : {}),
    ...(agentDefinitionId ? { agentDefinitionId } : {}),
    ...(skillCandidateId && skillCandidateDigest
      ? {
          skillCandidateId,
          skillCandidateDigest,
          ...(skillTestRequest ? { skillTestRequest } : {}),
        }
      : {}),
    ...(skillRevisionId ? { skillRevisionId } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
    ...(returnTo ? { returnTo } : {}),
  };
  const canvasDraftId =
    typeof search.canvasDraftId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.canvasDraftId)
      ? search.canvasDraftId
      : undefined;
  const canvasDraftVersion = Number(search.canvasDraftVersion);
  if (
    !canvasDraftId ||
    !Number.isSafeInteger(canvasDraftVersion) ||
    canvasDraftVersion < 1
  ) {
    return base;
  }
  const selectedElementKeys = agentSelectedElementKeys(
    search.selectedElementKeys,
  );
  return {
    ...base,
    canvasDraftId,
    canvasDraftVersion,
    selectedElementKeys,
    ...(typeof search.pageKey === "string" &&
    elementKeyPattern.test(search.pageKey)
      ? { pageKey: search.pageKey }
      : {}),
  };
}
