import type { CompleteAgentCanvasExportBody } from "@kanvas/contracts/api";
import type { AgentCanvasPngExportResultV1 } from "../editor/use-canvas-export-v1.js";
import { ApiProblem } from "../../api/transport.js";

const deliveryDelaysMs = [0, 1_000, 2_000, 4_000, 8_000] as const;
const terminalStatuses = new Set([400, 401, 403, 404, 409]);

/** Retry only delivery of an already determined result, never the export itself. */
export async function deliverAgentCanvasExport(
  send: () => Promise<void>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  for (const [index, delay] of deliveryDelaysMs.entries()) {
    if (delay) await wait(delay);
    try {
      await send();
      return;
    } catch (error) {
      if (
        (error instanceof ApiProblem && terminalStatuses.has(error.status)) ||
        index === deliveryDelaysMs.length - 1
      )
        throw error;
    }
  }
}

export async function executeAgentCanvasExport(options: {
  readonly signal: AbortSignal;
  readonly ready: Promise<unknown>;
  readonly render: () => Promise<AgentCanvasPngExportResultV1>;
  readonly cancel: () => void;
  readonly remember: (completion: CompleteAgentCanvasExportBody) => void;
  readonly report: (completion: CompleteAgentCanvasExportBody) => Promise<void>;
}): Promise<void> {
  const maximumErrorMessageLength = 4_000;
  options.signal.addEventListener("abort", options.cancel, { once: true });
  try {
    await options.ready;
    if (options.signal.aborted) return;
    const result = await options.render();
    let completion: CompleteAgentCanvasExportBody;
    if (result.status === "succeeded" && result.results[0]?.exportSessionId) {
      completion = { exportSessionId: result.results[0].exportSessionId };
    } else {
      if (options.signal.aborted) return;
      const error =
        result.status === "failed"
          ? result.error
          : new Error("No committed export session was returned.");
      completion = {
        error: {
          code: "canvas_export.failed",
          message:
            error instanceof Error
              ? error.message.slice(0, maximumErrorMessageLength)
              : "Canvas export failed.",
        },
      };
    }
    options.remember(completion);
    await deliverAgentCanvasExport(() => options.report(completion));
  } finally {
    options.signal.removeEventListener("abort", options.cancel);
  }
}
