import type { ToolSession } from "@kanvas/contracts/api";
import { ToolBridgeError } from "./bridge.js";
import { isTransientToolError } from "./tool-api.js";

/** Retries the same recovery receipt, never a new task or an implicit explicit-reopen. */
export function observeRuntimeOpening(options: {
  open: () => Promise<ToolSession>;
  onSession: (session: ToolSession) => void;
  onWaiting: () => void;
  onRejected: (error: unknown) => void;
}): () => void {
  let disposed = false;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function dispose() {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  }
  async function attempt() {
    if (disposed || pending) return;
    clearTimeout(timer);
    pending = true;
    try {
      const session = await options.open();
      if (disposed) return;
      dispose();
      options.onSession(session);
    } catch (error) {
      if (disposed) return;
      if (error instanceof ToolBridgeError || !isTransientToolError(error)) {
        dispose();
        options.onRejected(error);
        return;
      }
      failures += 1;
      options.onWaiting();
      timer = setTimeout(
        () => {
          void attempt();
        },
        Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4)),
      );
    } finally {
      pending = false;
    }
  }
  function resume() {
    if (document.visibilityState !== "hidden") void attempt();
  }
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  void attempt();
  return dispose;
}
