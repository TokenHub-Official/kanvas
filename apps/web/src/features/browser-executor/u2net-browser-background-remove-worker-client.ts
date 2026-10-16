import type {
  BackgroundRemoveInput,
  BrowserBackgroundRemoveResult,
} from "./u2net-browser-background-remove.js";
import type { BrowserU2NetConfiguration } from "./u2net-browser-types.js";

interface WorkerCompletedMessage {
  readonly requestId: string;
  readonly type: "completed";
  readonly result: BrowserBackgroundRemoveResult;
}

interface WorkerFailedMessage {
  readonly requestId: string;
  readonly type: "failed";
  readonly error: {
    readonly message: string;
    readonly name: string;
  };
}

export function createBrowserU2NetBackgroundRemover(
  configuration: BrowserU2NetConfiguration,
) {
  const pending = new Map<
    string,
    {
      readonly resolve: (result: BrowserBackgroundRemoveResult) => void;
      readonly reject: (error: Error) => void;
      readonly detachAbort: () => void;
    }
  >();
  let disposed = false;
  let activeWorker: Worker | undefined;
  const rejectAll = (error: Error) => {
    for (const request of pending.values()) {
      request.detachAbort();
      request.reject(error);
    }
    pending.clear();
  };
  const worker = (): Worker => {
    if (activeWorker) return activeWorker;
    const nextWorker = new Worker(
      new URL("./u2net-background-remove.worker.ts", import.meta.url),
      {
        name: "kanvas-u2net-background-remove",
        type: "module",
      },
    );
    nextWorker.addEventListener(
      "message",
      (event: MessageEvent<WorkerCompletedMessage | WorkerFailedMessage>) => {
        const request = pending.get(event.data.requestId);
        if (!request) return;
        pending.delete(event.data.requestId);
        request.detachAbort();
        if (event.data.type === "completed") {
          request.resolve(event.data.result);
          return;
        }
        const error = new Error(event.data.error.message);
        error.name = event.data.error.name;
        request.reject(error);
      },
    );
    nextWorker.addEventListener("error", (event) => {
      if (activeWorker === nextWorker) activeWorker = undefined;
      rejectAll(
        new Error(event.message || "Browser background-removal Worker failed."),
      );
      nextWorker.terminate();
    });
    activeWorker = nextWorker;
    return nextWorker;
  };
  return Object.freeze({
    execute(
      source: Blob,
      input: BackgroundRemoveInput,
      signal: AbortSignal,
    ): Promise<BrowserBackgroundRemoveResult> {
      signal.throwIfAborted();
      if (disposed) {
        return Promise.reject(
          new DOMException(
            "Browser background-removal runtime is disposed.",
            "InvalidStateError",
          ),
        );
      }
      const executionWorker = worker();
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const detachAbort = () => {
          signal.removeEventListener("abort", abort);
        };
        const abort = () => {
          pending.delete(requestId);
          executionWorker.postMessage({
            requestId,
            type: "cancel",
          });
          detachAbort();
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException(
                  "Browser background removal was aborted.",
                  "AbortError",
                ),
          );
        };
        pending.set(requestId, { resolve, reject, detachAbort });
        signal.addEventListener("abort", abort, {
          once: true,
        });
        executionWorker.postMessage({
          configuration,
          input,
          requestId,
          source,
          type: "execute",
        });
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      rejectAll(
        new DOMException(
          "Browser background-removal runtime was disposed.",
          "AbortError",
        ),
      );
      activeWorker?.terminate();
      activeWorker = undefined;
    },
  });
}
