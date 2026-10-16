import { ApiProblem } from "../../api/transport.js";
import type { ToolSession } from "@kanvas/contracts/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectRuntimeFrame } from "./runtime-frame.js";
import type { ToolRuntimeApi } from "./tool-api.js";
const session = {
  id: "session",
  revisionId: "revision",
  revisionDigest: "digest",
  available: true,
  expiresAt: "2099-01-01T00:00:00Z",
} as ToolSession;
function fixture() {
  vi.useFakeTimers();
  const host = Object.assign(new EventTarget(), {
    location: {
      href: "https://kanvas.example/tools",
      origin: "https://kanvas.example",
    },
  });
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", document);
  const frame = {
    src: "",
    setAttribute: vi.fn(),
    contentWindow: { postMessage: vi.fn() },
  };
  const get = vi.fn().mockResolvedValue(session);
  const close = vi.fn().mockResolvedValue(session);
  const onStopped = vi.fn();
  const onConnectionChange = vi.fn();
  const portClose = vi.fn();
  const ports: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        start() {},
        close: portClose,
        onmessage: null,
        postMessage: vi.fn(),
      };
      constructor() {
        ports.push(this.port1);
      }
      port2 = {};
    },
  );
  const options = {
    frame: frame as unknown as HTMLIFrameElement,
    session,
    api: {
      hostUrl: () => "/api/runtime/host",
      get,
      close,
    } as unknown as ToolRuntimeApi,
    execute: vi.fn(),
    onStopped,
    onConnectionChange,
  };
  const message = (source: unknown, origin: string, type: string) =>
    host.dispatchEvent(
      Object.assign(new Event("message"), {
        source,
        origin,
        data: { type, version: 1 },
      }),
    );
  return {
    frame,
    get,
    close,
    onStopped,
    portClose,
    options,
    message,
    host,
    document,
    onConnectionChange,
    ports,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("runtime frame authority watcher", () => {
  it("accepts only its exact trusted host and unloads on disable", async () => {
    const f = fixture();
    const dispose = connectRuntimeFrame(f.options);
    await vi.advanceTimersByTimeAsync(0);
    f.message({}, "https://kanvas.example", "kanvas.tool.host.ready");
    f.message(f.frame.contentWindow, "null", "kanvas.tool.host.ready");
    expect(f.frame.contentWindow.postMessage).not.toHaveBeenCalled();
    f.message(
      f.frame.contentWindow,
      "https://kanvas.example",
      "kanvas.tool.host.ready",
    );
    expect(f.frame.contentWindow.postMessage).toHaveBeenCalledWith(
      { type: "kanvas.tool.host.connect", version: 1 },
      "https://kanvas.example",
      [expect.any(Object)],
    );
    await vi.advanceTimersByTimeAsync(0);
    f.get.mockResolvedValue({
      ...session,
      available: false,
      unavailableReason: "disabled",
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.frame.src).toBe("about:blank");
    expect(f.portClose).toHaveBeenCalled();
    expect(f.onStopped).toHaveBeenCalledWith("disabled");
    dispose();
  });
  it("closes the server session after the trusted host reports navigation", () => {
    const f = fixture();
    const dispose = connectRuntimeFrame(f.options);
    f.message(
      f.frame.contentWindow,
      "https://kanvas.example",
      "kanvas.tool.host.stopped",
    );
    expect(f.close).toHaveBeenCalledWith(session.id);
    expect(f.onStopped).toHaveBeenCalledWith("frame_disconnected");
    dispose();
  });
  it("preserves the frame through an outage and resumes on return without recreating it", async () => {
    const f = fixture();
    const dispose = connectRuntimeFrame(f.options);
    f.message(
      f.frame.contentWindow,
      "https://kanvas.example",
      "kanvas.tool.host.ready",
    );
    await vi.advanceTimersByTimeAsync(0);
    const originalSrc = f.frame.src;
    f.document.visibilityState = "hidden";
    f.document.dispatchEvent(new Event("visibilitychange"));
    f.get.mockRejectedValue(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.frame.src).toBe(originalSrc);
    expect(f.onStopped).not.toHaveBeenCalled();
    expect(f.onConnectionChange).toHaveBeenLastCalledWith(false);
    // New bridge calls cannot execute while authority cannot be verified.
    f.ports[0]!.onmessage!({
      data: {
        version: 1,
        id: "offline",
        method: "capabilities.list",
        params: {},
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.execute).not.toHaveBeenCalled();
    expect(f.ports[0]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "connection_unavailable" }),
    );
    f.get.mockResolvedValue(session);
    f.document.visibilityState = "visible";
    f.document.dispatchEvent(new Event("visibilitychange"));
    f.host.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onConnectionChange).toHaveBeenLastCalledWith(true);
    expect(f.frame.src).toBe(originalSrc);
    f.ports[0]!.onmessage!({
      data: {
        version: 1,
        id: "online",
        method: "capabilities.list",
        params: {},
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.execute).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    dispose();
  });
  it("reduces background polling but checks immediately on foreground and online", async () => {
    const f = fixture();
    const dispose = connectRuntimeFrame(f.options);
    f.message(
      f.frame.contentWindow,
      "https://kanvas.example",
      "kanvas.tool.host.ready",
    );
    await vi.advanceTimersByTimeAsync(0);
    f.document.visibilityState = "hidden";
    f.document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.get).toHaveBeenCalledTimes(2);
    f.document.visibilityState = "visible";
    f.document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.get).toHaveBeenCalledTimes(3);
    f.host.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.get).toHaveBeenCalledTimes(4);
    dispose();
    f.host.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.get).toHaveBeenCalledTimes(4);
  });
  it("still expires while offline in the background", async () => {
    const f = fixture();
    f.get.mockRejectedValue(new Error("Offline"));
    f.document.visibilityState = "hidden";
    const dispose = connectRuntimeFrame({
      ...f.options,
      session: {
        ...session,
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      },
    });
    f.message(
      f.frame.contentWindow,
      "https://kanvas.example",
      "kanvas.tool.host.ready",
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.onStopped).toHaveBeenCalledWith("expired");
    expect(f.frame.src).toBe("about:blank");
    dispose();
  });
  it("immediately stops on a confirmed permission rejection", async () => {
    const f = fixture();
    f.get.mockRejectedValue(new ApiProblem(403, "forbidden", "Access revoked"));
    const dispose = connectRuntimeFrame(f.options);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.frame.src).toBe("about:blank");
    dispose();
  });
});

it("waits for authority before connecting an already-ready host", async () => {
  const f = fixture();
  let resolve!: (value: ToolSession) => void;
  f.get.mockReturnValue(
    new Promise<ToolSession>((done) => {
      resolve = done;
    }),
  );
  const dispose = connectRuntimeFrame(f.options);
  f.message(
    f.frame.contentWindow,
    "https://kanvas.example",
    "kanvas.tool.host.ready",
  );
  expect(f.ports).toHaveLength(0);
  resolve(session);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.ports).toHaveLength(1);
  dispose();
});

it("does not reconnect from a late authority response after disposal", async () => {
  const f = fixture();
  let resolve!: (value: ToolSession) => void;
  f.get.mockReturnValue(
    new Promise<ToolSession>((done) => {
      resolve = done;
    }),
  );
  const dispose = connectRuntimeFrame(f.options);
  f.message(
    f.frame.contentWindow,
    "https://kanvas.example",
    "kanvas.tool.host.ready",
  );
  dispose();
  resolve(session);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.frame.src).toBe("about:blank");
  expect(f.ports).toHaveLength(0);
  expect(f.onConnectionChange).not.toHaveBeenCalled();
  expect(f.get).toHaveBeenCalledOnce();
});

it("resets backoff after recovery and still rejects a changed revision", async () => {
  const f = fixture();
  const dispose = connectRuntimeFrame(f.options);
  f.message(
    f.frame.contentWindow,
    "https://kanvas.example",
    "kanvas.tool.host.ready",
  );
  await vi.advanceTimersByTimeAsync(0);
  f.get.mockRejectedValue(new Error("Offline"));
  await vi.advanceTimersByTimeAsync(14_000);
  const count = f.get.mock.calls.length;
  f.get.mockResolvedValue(session);
  f.host.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.get).toHaveBeenCalledTimes(count + 2);
  f.get.mockResolvedValue({ ...session, revisionDigest: "changed" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.onStopped).toHaveBeenCalledWith("revision_changed");
  expect(f.close).toHaveBeenCalledOnce();
  dispose();
});
