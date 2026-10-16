import { describe, expect, it, vi } from "vitest";
import { ApiProblem } from "../../api/transport.js";
import {
  deliverAgentCanvasExport,
  executeAgentCanvasExport,
} from "./agent-canvas-export-recovery.js";

describe("Agent export receipt delivery", () => {
  it("redelivers the same committed result after network failures", async () => {
    const body = { exportSessionId: "committed-session" };
    const post = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await deliverAgentCanvasExport(async () => {
      await post(body);
    }, wait);
    expect(post.mock.calls).toEqual([[body], [body], [body]]);
    expect(wait.mock.calls).toEqual([[1000], [2000]]);
  });
  it("retains the actual final error after bounded delivery attempts", async () => {
    const error = new TypeError("connection reset");
    const post = vi.fn().mockRejectedValue(error);
    await expect(deliverAgentCanvasExport(post, async () => {})).rejects.toBe(
      error,
    );
    expect(post).toHaveBeenCalledTimes(5);
  });
  it("does not retry a permission or snapshot rejection", async () => {
    const error = new ApiProblem(
      409,
      "agent.canvas_export_mismatch",
      "Snapshot mismatch",
    );
    const post = vi.fn().mockRejectedValue(error);
    await expect(deliverAgentCanvasExport(post)).rejects.toBe(error);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("Agent export cancellation boundary", () => {
  it("does not start rendering after its view is removed", async () => {
    const controller = new AbortController();
    const render = vi.fn();
    const report = vi.fn();
    const cancel = vi.fn();
    const done = executeAgentCanvasExport({
      signal: controller.signal,
      ready: Promise.resolve(),
      render,
      report,
      cancel,
      remember: vi.fn(),
    });
    controller.abort();
    await done;
    expect(render).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("preserves a committed file even when cancellation races its response", async () => {
    const controller = new AbortController();
    const report = vi.fn().mockResolvedValue(undefined);
    const remember = vi.fn();
    const render = vi.fn(() => {
      controller.abort();
      return Promise.resolve({
        status: "succeeded" as const,
        results: [
          {
            artifactId: "artifact",
            exportSessionId: "session",
            filename: "poster.png",
            pageName: "page",
          },
        ],
      });
    });
    await executeAgentCanvasExport({
      signal: controller.signal,
      ready: Promise.resolve(),
      render,
      report,
      cancel: vi.fn(),
      remember,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ exportSessionId: "session" });
    expect(remember).toHaveBeenCalledWith({ exportSessionId: "session" });
  });
});
