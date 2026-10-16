import type { ToolSession } from "@kanvas/contracts/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblem } from "../../api/transport.js";
import { observeRuntimeOpening } from "./runtime-opening.js";
import { createRuntimeSessionRecovery } from "./runtime-session.js";
import type { ToolRuntimeApi } from "./tool-api.js";

function fixture() {
  vi.useFakeTimers();
  const host = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", document);
  const session = { id: "session", available: true } as ToolSession;
  const options = {
    open: vi.fn().mockResolvedValue(session),
    onSession: vi.fn(),
    onWaiting: vi.fn(),
    onRejected: vi.fn(),
  };
  return { host, document, session, options };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("runtime opening recovery", () => {
  it("backs off transport errors and immediately retries when returning online", async () => {
    const f = fixture();
    f.options.open.mockRejectedValue(new TypeError("Offline"));
    const dispose = observeRuntimeOpening(f.options);
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.options.open).toHaveBeenCalledTimes(3);
    expect(f.options.onWaiting).toHaveBeenCalledTimes(3);
    f.options.open.mockResolvedValue(f.session);
    f.host.dispatchEvent(new Event("online"));
    f.host.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.open).toHaveBeenCalledTimes(4);
    expect(f.options.onSession).toHaveBeenCalledWith(f.session);
    await vi.advanceTimersByTimeAsync(60_000);
    f.host.dispatchEvent(new Event("focus"));
    expect(f.options.open).toHaveBeenCalledTimes(4);
    dispose();
  });
  it("does not retry confirmed rejection", async () => {
    const f = fixture();
    f.options.open.mockRejectedValue(
      new ApiProblem(403, "forbidden", "Revoked"),
    );
    observeRuntimeOpening(f.options);
    await vi.advanceTimersByTimeAsync(60_000);
    f.host.dispatchEvent(new Event("online"));
    expect(f.options.open).toHaveBeenCalledOnce();
    expect(f.options.onRejected).toHaveBeenCalledOnce();
  });
  it("ignores in-flight responses after leaving the page", async () => {
    const f = fixture();
    let resolve!: (session: ToolSession) => void;
    f.options.open.mockReturnValue(
      new Promise<ToolSession>((done) => {
        resolve = done;
      }),
    );
    const dispose = observeRuntimeOpening(f.options);
    dispose();
    resolve(f.session);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.onSession).not.toHaveBeenCalled();
    f.host.dispatchEvent(new Event("focus"));
    expect(f.options.open).toHaveBeenCalledOnce();
  });
  it("replays the same creation identity after an expired standalone session loses its replacement response", async () => {
    const f = fixture();
    const old = {
      ...f.session,
      toolId: "tool",
      revisionId: "revision",
      maximumRuns: 0,
      runIds: [],
    } as ToolSession;
    const replacement = { ...old, id: "replacement" };
    const api = {
      create: vi
        .fn()
        .mockResolvedValueOnce(old)
        .mockRejectedValueOnce(new TypeError("Response lost"))
        .mockResolvedValue(replacement),
      get: vi.fn().mockResolvedValue({
        ...old,
        available: false,
        unavailableReason: "expired",
      }),
      close: vi.fn().mockResolvedValue({ ...old, available: false }),
    };
    const recovery = createRuntimeSessionRecovery({
      api: api as unknown as ToolRuntimeApi,
      toolId: "tool",
      revisionId: "revision",
      principalId: "human",
      scopeKey: "use:workspace",
    });
    await recovery.openForDisplay();
    observeRuntimeOpening({ ...f.options, open: recovery.openForDisplay });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.close).toHaveBeenCalledOnce();
    expect(api.create.mock.calls[1]).toEqual(api.create.mock.calls[2]);
    expect(f.options.onSession).toHaveBeenCalledWith(replacement);
  });
});
