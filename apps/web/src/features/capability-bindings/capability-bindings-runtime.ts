import { ApiProblem } from "../../api/transport.js";
import { i18n } from "../../i18n/i18n.js";

const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;

export interface PendingCapabilityOrderMove {
  readonly bindingId: string;
  readonly adjacentBindingId: string;
  readonly direction: "earlier" | "later";
}

export function capabilityOperationError(error: unknown): {
  readonly title: string;
  readonly description: string;
} {
  if (!(error instanceof ApiProblem)) {
    return {
      title: i18n.t("settings.execution.errors.confirmingTitle"),
      description: i18n.t("settings.execution.errors.confirmingDescription"),
    };
  }
  if (error.status === HTTP_CONFLICT) {
    return {
      title: i18n.t("settings.execution.errors.conflictTitle"),
      description: i18n.t("settings.execution.errors.conflictDescription"),
    };
  }
  if (error.status === HTTP_FORBIDDEN) {
    return {
      title: i18n.t("settings.execution.errors.forbiddenTitle"),
      description: i18n.t("settings.execution.errors.forbiddenDescription"),
    };
  }
  return {
    title: i18n.t("settings.execution.errors.genericTitle"),
    description: i18n.t("settings.execution.errors.genericDescription"),
  };
}
