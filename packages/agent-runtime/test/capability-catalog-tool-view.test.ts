import { describe, expect, it, vi } from "vitest";

import { createCapabilityCatalogToolProjection } from "../src/capability-catalog-tool-view.js";

describe("Capability Catalog Tool projection", () => {
  it("separates read-only discovery from reviewable invocation", async () => {
    const search = vi.fn(() =>
      Promise.resolve({
        modelOutput: { capabilities: [] },
        outcomeReference: { kind: "query" as const, resultCount: 0 },
      }),
    );
    const invoke = vi.fn(() =>
      Promise.resolve({
        modelOutput: { proposalId: "01K00000000000000000000001" },
        outcomeReference: {
          kind: "workflow_run" as const,
          workflowRunId: "01K00000000000000000000002",
        },
      }),
    );
    const projection = createCapabilityCatalogToolProjection({
      search,
      invoke,
    });
    expect(projection.family).toBe("capability");
    expect(projection.descriptors).toHaveLength(2);
    expect(projection.descriptors[0]).toMatchObject({
      key: "capability.search",
      effect: "read",
      approvalMode: "none",
    });
    await projection.descriptors[0]?.executeCanonical({ query: "background" });
    expect(search).toHaveBeenCalledWith({ query: "background" });
    expect(projection.descriptors[1]).toMatchObject({
      key: "capability.invoke",
      effect: "compute",
      approvalMode: "before-commit",
    });
    await projection.descriptors[1]?.executeCanonical({
      capabilityKey: "image.background.remove",
      input: { sourceArtifactId: "01K00000000000000000000002" },
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("keeps approval lifecycle in the Task card instead of prompting through prose", async () => {
    const projection = createCapabilityCatalogToolProjection({
      search: () =>
        Promise.resolve({
          modelOutput: { capabilities: [] },
          outcomeReference: { kind: "query", resultCount: 0 },
        }),
      invoke: () =>
        Promise.resolve({
          modelOutput: {
            status: "awaiting_approval",
            capabilityKey: "image.generate",
            title: "Image generation",
          },
        }),
    });
    const invoke = projection.descriptors[1];
    const canonical = await invoke?.executeCanonical({
      capabilityKey: "image.generate",
      input: { prompt: "A quiet spring morning" },
    });

    expect(canonical).toEqual({
      modelOutput: {
        status: "awaiting_approval",
        capabilityKey: "image.generate",
        title: "Image generation",
      },
    });
    expect(invoke?.toModelOutput?.(canonical)).toEqual({
      status: "prepared",
      title: "Image generation",
      taskStatusSource: "task_card",
      responseGuidance:
        "The task is ready. In the user's language, say they can check its progress in the task card. Do not ask the user to confirm in prose, and do not claim that execution has started or completed.",
    });
    expect(JSON.stringify(invoke?.toModelOutput?.(canonical))).not.toContain(
      "image.generate",
    );
  });
});
