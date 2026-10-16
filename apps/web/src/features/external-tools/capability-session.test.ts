import { ApiProblem } from "../../api/transport.js";
import type {
  CapabilityRunDetails,
  UserCapabilitySummary,
} from "@kanvas/contracts/api";
import { describe, expect, it, vi } from "vitest";
import { createCapabilityToolSession } from "./capability-session.js";
import { parseToolRequest, type ToolRequest } from "./bridge.js";
import { supportsBasicTool } from "./catalog.js";

const contract = "01K00000000000000000000001";
const runId = "01K00000000000000000000002";
const capability: UserCapabilitySummary = {
  contractRevisionId: contract,
  capabilityKey: "text.generate",
  displayName: "Generate text",
  category: "Text",
  inputSchema: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
  parameters: [],
  outputs: [],
};
const run = (status: CapabilityRunDetails["lifecycleStatus"] = "queued") =>
  ({
    id: runId,
    lifecycleStatus: status,
    output: status === "completed" ? "Done" : undefined,
  }) as CapabilityRunDetails;
const request = (method: ToolRequest["method"], params = {}): ToolRequest => ({
  version: 1,
  id: crypto.randomUUID(),
  method,
  params,
});
const startRequest = () =>
  request("run.start", { capabilityId: contract, input: { prompt: "Hello" } });
function setup() {
  const data = new Map<string, string>();
  const deps = {
    allowed: true,
    list: vi.fn().mockResolvedValue({ items: [capability], truncated: false }),
    start: vi.fn().mockResolvedValue(run()),
    status: vi.fn().mockResolvedValue(run()),
    cancel: vi.fn().mockResolvedValue(run("cancelled")),
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    },
    storageKey: "user-a:workspace-a",
  };
  return { deps, execute: createCapabilityToolSession(deps) };
}

describe("external tool authority and recovery", () => {
  it("accepts only bounded, versioned allowlisted requests", () => {
    expect(parseToolRequest(request("run.status"))).toBeDefined();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(parseToolRequest(request("run.start", circular))).toBeUndefined();
    expect(
      parseToolRequest(request("run.start", { value: BigInt(1) })),
    ).toBeUndefined();
    expect(
      parseToolRequest({ ...request("run.status"), method: "fetch" }),
    ).toBeUndefined();
    expect(
      parseToolRequest({ ...request("run.status"), version: 2 }),
    ).toBeUndefined();
    expect(
      parseToolRequest(request("run.start", { input: "x".repeat(33000) })),
    ).toBeUndefined();
  });
  it("does not invoke any dependency without run permission", async () => {
    const { deps } = setup();
    const execute = createCapabilityToolSession({ ...deps, allowed: false });
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  });
  it("rechecks availability and denies arbitrary revision IDs", async () => {
    const { deps, execute } = setup();
    await execute(request("capabilities.list"));
    deps.list.mockResolvedValue({ items: [], truncated: false });
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(deps.start).not.toHaveBeenCalled();
  });
  it("recovers an uncertain submission with the same key after remount", async () => {
    const { deps, execute } = setup();
    deps.start.mockRejectedValueOnce(new Error("response lost"));
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "submission_unknown",
    });
    const resumed = createCapabilityToolSession(deps);
    await expect(
      resumed(
        request("run.start", {
          capabilityId: contract,
          input: { prompt: "Changed" },
        }),
      ),
    ).rejects.toMatchObject({ code: "previous_pending" });
    expect(await resumed(startRequest())).toMatchObject({ status: "queued" });
    expect(deps.start.mock.calls[0]?.[1]).toBe(deps.start.mock.calls[1]?.[1]);
  });
  it("retains a previously uncertain receipt even if a later retry is rejected", async () => {
    const { deps, execute } = setup();
    deps.start.mockRejectedValueOnce(new TypeError("Lost response"));
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "submission_unknown",
    });
    deps.start.mockRejectedValueOnce(
      new ApiProblem(403, "disabled", "Disabled"),
    );
    const resumed = createCapabilityToolSession(deps);
    await expect(resumed(startRequest())).rejects.toMatchObject({
      code: "submission_unknown",
    });
    await expect(
      resumed(
        request("run.start", {
          capabilityId: contract,
          input: { prompt: "Different" },
        }),
      ),
    ).rejects.toMatchObject({ code: "previous_pending" });
    expect(deps.start.mock.calls[0]?.[1]).toBe(deps.start.mock.calls[1]?.[1]);
  });
  it("permits corrected input after a first definitive rejection", async () => {
    const { deps, execute } = setup();
    deps.start.mockRejectedValueOnce(new ApiProblem(400, "input", "Invalid"));
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "rejected",
    });
    await execute(
      request("run.start", {
        capabilityId: contract,
        input: { prompt: "Corrected" },
      }),
    );
    expect(deps.start.mock.calls[0]?.[1]).not.toBe(
      deps.start.mock.calls[1]?.[1],
    );
  });
  it("serializes starts, blocks another active run, and returns completed output", async () => {
    const { deps, execute } = setup();
    const first = execute(startRequest());
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "busy",
    });
    await first;
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "run_active",
    });
    deps.status.mockResolvedValue(run("completed"));
    expect(
      await execute(request("run.status", { runId: "another-users-run" })),
    ).toMatchObject({ status: "completed", output: "Done" });
    expect(deps.status).toHaveBeenLastCalledWith(runId);
    await execute(startRequest());
    expect(deps.start.mock.calls[0]?.[1]).not.toBe(
      deps.start.mock.calls[1]?.[1],
    );
  });
  it("does not restore a different principal or workspace's task", async () => {
    const { deps, execute } = setup();
    await execute(startRequest());
    const other = createCapabilityToolSession({
      ...deps,
      storageKey: "user-b:workspace-b",
    });
    await expect(other(request("run.status"))).rejects.toMatchObject({
      code: "no_run",
    });
  });
  it("cancels only its own submitted run", async () => {
    const { deps, execute } = setup();
    await execute(startRequest());
    expect(
      await execute(request("run.cancel", { runId: "other" })),
    ).toMatchObject({ status: "cancelled" });
    expect(deps.cancel).toHaveBeenCalledWith(runId, expect.any(String));
  });
  it("restores trusted results through the host without starting another run", async () => {
    const { deps, execute } = setup();
    await execute(startRequest());
    const completed = run("completed");
    const onRun = vi.fn();
    deps.status.mockResolvedValue(completed);
    const restored = createCapabilityToolSession({ ...deps, onRun });
    await restored(request("run.status"));
    expect(onRun).toHaveBeenCalledWith(completed);
    expect(deps.start).toHaveBeenCalledTimes(1);
  });
  it("restores a server-recorded run when browser run storage was lost", async () => {
    const { deps } = setup();
    const recover = vi.fn().mockResolvedValue({
      ...run(),
      contractRevisionId: contract,
      input: { prompt: "Recovered" },
    });
    const execute = createCapabilityToolSession({ ...deps, recover });
    await expect(execute(startRequest())).rejects.toMatchObject({
      code: "run_active",
    });
    expect(deps.start).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
    await execute(request("run.status"));
    expect(deps.status).toHaveBeenCalledWith(runId);
  });
  it("lets an uploaded tool use an explicitly granted structured capability", async () => {
    const { deps } = setup();
    deps.list.mockResolvedValue({
      items: [
        {
          ...capability,
          inputSchema: {
            type: "object",
            properties: { messages: { type: "array" } },
          },
        },
      ],
      truncated: false,
    });
    const execute = createCapabilityToolSession({
      ...deps,
      supports: (item) => item.contractRevisionId === contract,
    });
    expect(
      await execute(
        request("run.start", {
          capabilityId: contract,
          input: { messages: [] },
        }),
      ),
    ).toMatchObject({ status: "queued" });
  });
  it("excludes nested inputs and artifact-dependent tools from the basic form", () => {
    expect(supportsBasicTool(capability)).toBe(true);
    expect(
      supportsBasicTool({
        ...capability,
        inputSchema: {
          type: "object",
          properties: { messages: { type: "array" } },
        },
      }),
    ).toBe(false);
    expect(
      supportsBasicTool({
        ...capability,
        inputSchema: { ...capability.inputSchema, oneOf: [] },
      }),
    ).toBe(false);
  });
});
