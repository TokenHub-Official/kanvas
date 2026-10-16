import { describe, expect, it } from "vitest";
import {
  agentEntryNeedsFreshDraft,
  prepareAgentEntryDraft,
  validateAgentCanvasSearch,
} from "./agent-entry-search.js";
import { composerDraftStorageKey } from "./agent-composer-draft.js";
import { returnToFromLocation } from "../../auth/entry-recovery.js";
const workspaceId = "01K00000000000000000000000";
const agentId = "01M1KV3G91YX4E0KKYQ7VA5FMM";
describe("conversation links", () => {
  it("preserves exact encoded text and Agent ID, including multiline punctuation", () => {
    const prompt = ' 中文 & + #\n?agentDefinitionId=other "quoted" ';
    const query = new URLSearchParams({
      agentDefinitionId: agentId,
      initialPrompt: prompt,
    });
    expect(
      validateAgentCanvasSearch(
        Object.fromEntries(new URLSearchParams(query.toString())),
      ),
    ).toEqual({ agentDefinitionId: agentId, initialPrompt: prompt });
    expect(
      validateAgentCanvasSearch({ initialPrompt: "a".repeat(8000) }),
    ).toHaveProperty("initialPrompt");
  });

  it("keeps invalid explicit selections distinguishable from the default Agent", () => {
    expect(
      validateAgentCanvasSearch({
        agentDefinitionId: "bad",
        initialPrompt: "keep this",
      }),
    ).toEqual({ invalidAgentSelection: true, initialPrompt: "keep this" });
    expect(
      validateAgentCanvasSearch({ initialPrompt: "a".repeat(8001) }),
    ).toEqual({ invalidInitialPrompt: true });
    expect(
      validateAgentCanvasSearch({
        invalidAgentSelection: true,
        draftId: "76d97f53-3e71-4f6b-a270-d7c74aeb0b2c",
      }),
    ).toMatchObject({ invalidAgentSelection: true });
  });
  it("preserves the prepared draft and Agent through login recovery", () => {
    const pathname = `/w/${workspaceId}/agent`;
    const search = `?agentDefinitionId=${agentId}&draftId=76d97f53-3e71-4f6b-a270-d7c74aeb0b2c`;
    expect(returnToFromLocation({ pathname, search })).toBe(pathname + search);
  });

  it("prepares a Skill entry once without reusing the generic new-conversation draft", () => {
    const draftId = "76d97f53-3e71-4f6b-a270-d7c74aeb0b2c";
    const entry = validateAgentCanvasSearch({
      skillRevisionId: agentId,
      returnTo: `/w/${workspaceId}/skills`,
    });
    expect(agentEntryNeedsFreshDraft(entry)).toBe(true);
    const prepared = prepareAgentEntryDraft(entry, draftId);
    expect(prepared).toEqual({
      search: {
        skillRevisionId: agentId,
        returnTo: `/w/${workspaceId}/skills`,
        draftId,
      },
    });
    expect(
      composerDraftStorageKey(workspaceId, undefined, prepared?.search.draftId),
    ).toBe(`kanvas:agent-composer:${workspaceId}:new:${draftId}`);
    expect(
      composerDraftStorageKey(workspaceId, undefined, prepared?.search.draftId),
    ).not.toBe(composerDraftStorageKey(workspaceId, undefined));
    expect(
      prepareAgentEntryDraft(prepared?.search ?? {}, crypto.randomUUID()),
    ).toBeUndefined();
  });

  it("keeps an explicit Agent choice authoritative and ignores return-only links", () => {
    const entry = validateAgentCanvasSearch({
      agentDefinitionId: agentId,
      skillRevisionId: "01M2J8WCV00000000000000000",
    });
    expect(
      prepareAgentEntryDraft(entry, "76d97f53-3e71-4f6b-a270-d7c74aeb0b2c")
        ?.search,
    ).toMatchObject({ agentDefinitionId: agentId });
    expect(
      agentEntryNeedsFreshDraft(
        validateAgentCanvasSearch({ returnTo: `/w/${workspaceId}/skills` }),
      ),
    ).toBe(false);
  });
});
