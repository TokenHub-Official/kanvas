import type {
  AgentCapabilityAssessment,
  AgentCapabilityDiscovery,
  CapabilityDefinitionAdminStore,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";
import { createAgentCapabilityCatalogExecutor } from "../src/agent/capability-catalog-executor.js";

const ready: AgentCapabilityAssessment = {
  availability: { status: "ready", stage: "invocation" },
  capability: {
    key: "image.generate",
    contractRevisionId: "01K00000000000000000000001",
    contractRevision: 2,
    declaration: {
      schemaVersion: "kanvas.capability-declaration/v1",
      origin: "declared",
      catalog: {
        title: { "zh-CN": "图片生成", "en-US": "Image generation" },
        category: { "zh-CN": "图像生成", "en-US": "Image generation" },
        sourceKind: "built_in",
        tags: ["image"],
        surfaces: ["agent"],
      },
      parameters: [],
      outputs: [],
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: { prompt: { type: "string", minLength: 1 } },
    },
    outputSchema: {},
    activeBindingCount: 1,
  },
};
const page = (
  items: readonly AgentCapabilityAssessment[],
  complete = true,
): AgentCapabilityDiscovery => ({
  items,
  complete,
  evaluatedAt: "2026-09-20T00:00:00.000Z",
  ...(!complete ? { nextCursor: "image.generate" } : {}),
});
function fixture() {
  const discoverAgentCatalog = vi.fn<
    CapabilityDefinitionAdminStore["discoverAgentCatalog"]
  >(() => Promise.resolve(page([ready])));
  const resolveAgentCapability = vi.fn<
    CapabilityDefinitionAdminStore["resolveAgentCapability"]
  >(() => Promise.resolve(ready));
  const prepareInvoke = vi.fn(() =>
    Promise.resolve({ modelOutput: { status: "prepared" } }),
  );
  const executor = createAgentCapabilityCatalogExecutor({
    authority: {} as never,
    catalog: {
      discoverAgentCatalog,
      resolveAgentCapability,
    } as unknown as CapabilityDefinitionAdminStore,
    locale: "en-US",
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    prepareInvoke,
    executeWithReceipt: (_key, _input, operation) => operation({} as never),
  });
  return {
    executor,
    discoverAgentCatalog,
    resolveAgentCapability,
    prepareInvoke,
  };
}

describe("Agent Capability Catalog executor", () => {
  it("returns public schemas and completeness without internal revision IDs", async () => {
    const { executor } = fixture();
    const result = await executor.search({ query: "image" });
    expect(result.modelOutput).toMatchObject({
      catalogState: "ready",
      complete: true,
      capabilities: [
        { key: "image.generate", inputSchema: ready.capability.inputSchema },
      ],
    });
    expect(JSON.stringify(result.modelOutput)).not.toContain(
      ready.capability.contractRevisionId,
    );
  });
  it("falls back once only for a complete keyword miss", async () => {
    const { executor, discoverAgentCatalog } = fixture();
    discoverAgentCatalog.mockResolvedValueOnce(page([]));
    expect(
      (await executor.search({ query: "synonym" })).modelOutput,
    ).toMatchObject({ queryMatched: false, catalogState: "ready" });
    expect(discoverAgentCatalog).toHaveBeenLastCalledWith(
      {},
      {},
      new Date("2026-09-20T00:00:00Z"),
    );
    expect(discoverAgentCatalog).toHaveBeenCalledTimes(2);
  });
  it("does not call a partial or unavailable catalog empty", async () => {
    const { executor, discoverAgentCatalog } = fixture();
    discoverAgentCatalog.mockResolvedValueOnce(page([], false));
    expect(
      (await executor.search({ query: "image" })).modelOutput,
    ).toMatchObject({
      catalogState: "partial",
      complete: false,
      nextCursor: "image.generate",
    });
    expect(discoverAgentCatalog).toHaveBeenCalledTimes(1);
    discoverAgentCatalog.mockResolvedValueOnce(
      page([
        {
          ...ready,
          availability: {
            status: "unavailable",
            stage: "invocation",
            reason: "schema_conflict",
          },
        },
      ]),
    );
    const result = await executor.search({ query: "image" });
    expect(result.modelOutput).toMatchObject({
      catalogState: "unavailable",
      capabilities: [],
      unavailableCapabilities: [
        { key: "image.generate", reason: "schema_conflict" },
      ],
    });
    expect(result.outcomeReference).toMatchObject({
      diagnostics: {
        exclusions: [{ reason: "schema_conflict" }],
        durationMs: 0,
      },
    });
    expect(discoverAgentCatalog).toHaveBeenCalledTimes(2);
  });
  it("propagates evaluation failures instead of manufacturing absence, and allows recovery", async () => {
    const { executor, discoverAgentCatalog } = fixture();
    discoverAgentCatalog.mockRejectedValueOnce(new Error("query unavailable"));
    await expect(executor.search({ query: "image" })).rejects.toThrow(
      "query unavailable",
    );
    expect(
      (await executor.search({ query: "image" })).modelOutput,
    ).toMatchObject({ catalogState: "ready" });
  });
  it("reports empty only after complete unfiltered discovery and never falls back on a cursor", async () => {
    const { executor, discoverAgentCatalog } = fixture();
    discoverAgentCatalog.mockResolvedValue(page([]));
    expect(
      (await executor.search({ query: "image" })).modelOutput,
    ).toMatchObject({ catalogState: "empty", complete: true });
    expect(discoverAgentCatalog).toHaveBeenCalledTimes(2);
    expect(
      (await executor.search({ query: "image", afterKey: "image.generate" }))
        .modelOutput,
    ).toMatchObject({ catalogState: "no_match" });
    expect(discoverAgentCatalog).toHaveBeenCalledTimes(3);
  });
  it("resolves the exact key without using search and rechecks readiness at invocation", async () => {
    const {
      executor,
      discoverAgentCatalog,
      resolveAgentCapability,
      prepareInvoke,
    } = fixture();
    await executor.invoke({
      capabilityKey: "image.generate",
      input: { prompt: "A paper kite" },
    });
    expect(discoverAgentCatalog).not.toHaveBeenCalled();
    expect(resolveAgentCapability).toHaveBeenCalledWith(
      {},
      "image.generate",
      new Date("2026-09-20T00:00:00Z"),
    );
    expect(prepareInvoke).toHaveBeenCalledWith({
      capabilityKey: "image.generate",
      contractRevisionId: ready.capability.contractRevisionId,
      title: "Image generation",
      description: "Image generation",
      input: { prompt: "A paper kite" },
    });
    resolveAgentCapability.mockResolvedValueOnce({
      ...ready,
      availability: {
        status: "unavailable",
        stage: "binding",
        reason: "budget_unavailable",
      },
    });
    expect(
      (
        await executor.invoke({
          capabilityKey: "image.generate",
          input: { prompt: "A paper kite" },
        })
      ).modelOutput,
    ).toMatchObject({ status: "unavailable", reason: "budget_unavailable" });
    expect(prepareInvoke).toHaveBeenCalledTimes(1);
  });
  it("rejects private execution fields and does not prepare unknown capabilities", async () => {
    const { executor, resolveAgentCapability, prepareInvoke } = fixture();
    resolveAgentCapability.mockResolvedValueOnce(undefined);
    expect(
      (
        await executor.invoke({
          capabilityKey: "image.hidden",
          input: { prompt: "kite" },
        })
      ).modelOutput,
    ).toMatchObject({ status: "unavailable", reason: "not_found" });
    await expect(
      executor.invoke({
        capabilityKey: "image.generate",
        input: { prompt: "kite", implementationRevisionId: "private" },
      }),
    ).rejects.toThrow("published public interface");
    expect(prepareInvoke).not.toHaveBeenCalled();
  });
});
