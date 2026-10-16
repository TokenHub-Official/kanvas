import { describe, expect, it, vi } from "vitest";

import {
  trackCanvasBrowserRuntimeV1,
  type CanvasBrowserRuntimeControlV1,
} from "./use-canvas-browser-runtimes-v1.js";

describe("Canvas browser runtime tracking", () => {
  it("attaches completion handling before stopping a late runtime", () => {
    const order: string[] = [];
    const done = Promise.resolve();
    vi.spyOn(done, "catch").mockImplementation(() => {
      order.push("catch");
      return Promise.resolve();
    });
    const runtime: CanvasBrowserRuntimeControlV1 = {
      done,
      stop: vi.fn(() => {
        order.push("stop");
      }),
    };
    const runtimes = new Set<CanvasBrowserRuntimeControlV1>();

    trackCanvasBrowserRuntimeV1(runtime, true, runtimes);

    expect(order).toEqual(["catch", "stop"]);
    expect(runtimes.size).toBe(0);
  });

  it("tracks an active runtime after attaching completion handling", () => {
    const done = Promise.resolve();
    const catchSpy = vi.spyOn(done, "catch");
    const stop = vi.fn();
    const runtime: CanvasBrowserRuntimeControlV1 = {
      done,
      stop,
    };
    const runtimes = new Set<CanvasBrowserRuntimeControlV1>();

    trackCanvasBrowserRuntimeV1(runtime, false, runtimes);

    expect(catchSpy).toHaveBeenCalledOnce();
    expect(runtimes.has(runtime)).toBe(true);
    expect(stop).not.toHaveBeenCalled();
  });
});
