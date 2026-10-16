import { describe, expect, it } from "vitest";

import { privateConversationArtifactOwner } from "../src/runtime/conversation-artifact-privacy.js";

const base = {
  assetId: null,
  createdByPrincipalId: null,
  createdByCapabilityPrincipalId: null,
  capabilityInvocationKind: null,
  createdByWorkflowPrincipalId: null,
  workflowIdempotencyKey: null,
  metadata: {},
};

describe("conversation Artifact privacy", () => {
  it("keeps Agent composer uploads and Agent results private until explicit Asset adoption", () => {
    expect(
      privateConversationArtifactOwner({
        ...base,
        createdByPrincipalId: "uploader",
        metadata: { importedFrom: "agent-composer" },
      }),
    ).toBe("uploader");
    expect(
      privateConversationArtifactOwner({
        ...base,
        createdByCapabilityPrincipalId: "runner",
        capabilityInvocationKind: "agent",
      }),
    ).toBe("runner");
    expect(
      privateConversationArtifactOwner({
        ...base,
        createdByWorkflowPrincipalId: "runner",
        workflowIdempotencyKey: "agent-workflow:receipt",
        capabilityInvocationKind: "workflow",
      }),
    ).toBe("runner");
    expect(
      privateConversationArtifactOwner({
        ...base,
        assetId: "shared-asset",
        createdByPrincipalId: "uploader",
        metadata: { importedFrom: "agent-composer" },
      }),
    ).toBeUndefined();
  });

  it("does not change ordinary Workspace uploads and Workflow results", () => {
    expect(
      privateConversationArtifactOwner({
        ...base,
        createdByPrincipalId: "uploader",
        metadata: {},
      }),
    ).toBeUndefined();
    expect(
      privateConversationArtifactOwner({
        ...base,
        createdByWorkflowPrincipalId: "runner",
        workflowIdempotencyKey: "ordinary-workflow:receipt",
        capabilityInvocationKind: "workflow",
      }),
    ).toBeUndefined();
  });
});
