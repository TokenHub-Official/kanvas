/// <reference lib="webworker" />

import {
  createDirectBrowserU2NetBackgroundRemover,
  type BackgroundRemoveInput,
} from "./u2net-browser-background-remove.js";
import type { BrowserU2NetConfiguration } from "./u2net-browser-types.js";

interface ExecuteMessage {
  readonly configuration: BrowserU2NetConfiguration;
  readonly input: BackgroundRemoveInput;
  readonly requestId: string;
  readonly source: Blob;
  readonly type: "execute";
}

interface CancelMessage {
  readonly requestId: string;
  readonly type: "cancel";
}

const executions = new Map<string, AbortController>();
let remover:
  ReturnType<typeof createDirectBrowserU2NetBackgroundRemover> | undefined;
let configurationIdentity: string | undefined;

self.addEventListener(
  "message",
  (event: MessageEvent<ExecuteMessage | CancelMessage>) => {
    if (event.data.type === "cancel") {
      executions.get(event.data.requestId)?.abort();
      return;
    }
    const { configuration, input, requestId, source } = event.data;
    const controller = new AbortController();
    executions.set(requestId, controller);
    const nextConfigurationIdentity = JSON.stringify(configuration);
    if (!remover || configurationIdentity !== nextConfigurationIdentity) {
      remover = createDirectBrowserU2NetBackgroundRemover(configuration);
      configurationIdentity = nextConfigurationIdentity;
    }
    void remover
      .execute(source, input, controller.signal)
      .then((result) => {
        self.postMessage({
          requestId,
          type: "completed",
          result,
        });
      })
      .catch((error: unknown) => {
        self.postMessage({
          requestId,
          type: "failed",
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : {
                  message: String(error),
                  name: "Error",
                },
        });
      })
      .finally(() => {
        executions.delete(requestId);
      });
  },
);

export {};
