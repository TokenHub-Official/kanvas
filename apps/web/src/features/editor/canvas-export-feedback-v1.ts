import { ApiProblem } from "../../api/transport.js";
import { i18n } from "../../i18n/i18n.js";

const browserTransportMessages = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);

export function canvasExportFailureMessageV1(error: unknown): string {
  if (
    (error instanceof TypeError &&
      browserTransportMessages.has(error.message)) ||
    (error instanceof ApiProblem && error.status === 0)
  ) {
    return i18n.t("canvas.exportPanel.uncertain");
  }
  return error instanceof Error
    ? error.message
    : i18n.t("canvas.exportPanel.failed");
}
