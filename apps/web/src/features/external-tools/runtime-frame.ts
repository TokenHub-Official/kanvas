import type { ToolSession } from "@kanvas/contracts/api";
import {
  connectToolPort,
  record,
  ToolBridgeError,
  type ToolRequest,
} from "./bridge.js";
import { isTransientToolError, type ToolRuntimeApi } from "./tool-api.js";

/** No page layout decisions: connects an existing iframe to the trusted runtime host. */
export function connectRuntimeFrame(options: {
  frame: HTMLIFrameElement;
  session: ToolSession;
  api: ToolRuntimeApi;
  execute: (request: ToolRequest) => Promise<unknown>;
  onStopped: (reason: string) => void;
  onConnectionChange?: (available: boolean) => void;
  onDiagnostic?: (message: string, line: number | null) => void;
}) {
  const { frame, session, api } = options;
  const url = new URL(api.hostUrl(session.id), window.location.href);
  if (url.origin !== window.location.origin || url.search || url.hash)
    throw new Error("Tool host must be a same-origin runtime URL.");
  let disposed = false;
  let connected = false;
  let hostReady = false;
  let checking = false;
  let transportFailures = 0;
  let verified = false;
  let disconnect: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(pollTimer);
    clearTimeout(handshakeTimer);
    clearTimeout(expiryTimer);
    window.removeEventListener("message", message);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", refresh);
    disconnect?.();
    frame.contentWindow?.postMessage(
      { type: "kanvas.tool.host.close", version: 1 },
      url.origin,
    );
    frame.src = "about:blank";
  }
  function stop(reason: string, revoke = false) {
    if (disposed) return;
    dispose();
    if (revoke) void api.close(session.id).catch(() => undefined);
    options.onStopped(reason);
  }
  function message(event: MessageEvent<unknown>) {
    if (
      disposed ||
      event.source !== frame.contentWindow ||
      event.origin !== url.origin
    )
      return;
    const data = record(event.data);
    if (data?.version !== 1) return;
    if (data.type === "kanvas.tool.host.diagnostic") {
      if (typeof data.message === "string" && data.message.length <= 600)
        options.onDiagnostic?.(
          data.message,
          typeof data.line === "number" &&
            Number.isSafeInteger(data.line) &&
            data.line > 0
            ? data.line
            : null,
        );
      return;
    }
    if (data.type === "kanvas.tool.host.stopped") {
      stop("frame_disconnected", true);
      return;
    }
    if (data.type !== "kanvas.tool.host.ready" || connected) return;
    hostReady = true;
    clearTimeout(handshakeTimer);
    connect();
  }
  function connect() {
    if (disposed || connected || !hostReady || !verified) return;
    connected = true;
    const channel = new MessageChannel();
    disconnect = connectToolPort(channel.port1, async (request) => {
      if (disposed || !verified)
        throw new ToolBridgeError("connection_unavailable");
      if (Date.parse(session.expiresAt) <= Date.now()) {
        stop("expired");
        throw new ToolBridgeError("expired");
      }
      return options.execute(request);
    });
    frame.contentWindow?.postMessage(
      { type: "kanvas.tool.host.connect", version: 1 },
      url.origin,
      [channel.port2],
    );
  }
  async function check() {
    if (disposed || checking) return;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      stop("expired");
      return;
    }
    checking = true;
    clearTimeout(pollTimer);
    try {
      const current = await api.get(session.id);
      if (disposed) return;
      if (!current.available) {
        stop(current.unavailableReason ?? "unavailable");
        return;
      }
      if (
        current.id !== session.id ||
        current.revisionId !== session.revisionId ||
        current.revisionDigest !== session.revisionDigest
      ) {
        stop("revision_changed", true);
        return;
      }
      transportFailures = 0;
      verified = true;
      connect();
      options.onConnectionChange?.(true);
    } catch (error) {
      if (disposed) return;
      verified = false;
      if (!isTransientToolError(error)) {
        stop("authority_unavailable");
        return;
      }
      transportFailures += 1;
      options.onConnectionChange?.(false);
    } finally {
      checking = false;
      schedule();
    }
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (disposed || checking) return;
    const delay =
      document.visibilityState === "hidden"
        ? 30_000
        : Math.min(30_000, 2000 * 2 ** Math.min(transportFailures, 4));
    pollTimer = setTimeout(() => {
      void check();
    }, delay);
  }
  function refresh() {
    if (document.visibilityState !== "hidden") void check();
    else schedule();
  }
  // Background throttling may delay polling; expiry is also checked before every bridge call.
  const expiryTimer = setTimeout(
    () => stop("expired"),
    Math.min(
      2_147_483_647,
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    ),
  );
  const handshakeTimer = setTimeout(() => {
    stop("connection_timeout");
  }, 10000);
  if (!session.available) {
    stop(session.unavailableReason ?? "unavailable");
    return dispose;
  }
  window.addEventListener("message", message);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = url.href;
  void check();
  return dispose;
}
