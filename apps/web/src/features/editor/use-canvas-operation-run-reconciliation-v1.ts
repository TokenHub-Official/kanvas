import type { CapabilityRunDetails } from "@kanvas/contracts/api";
import { useEffect, type Dispatch, type SetStateAction } from "react";

import {
  canvasOperationMessageAfterRunReconcileV1,
  reconcileCanvasOperationRunV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";

const terminalCapabilityRunStatuses = new Set([
  "cancelled",
  "completed",
  "failed",
]);

export function useCanvasOperationRunReconciliationV1({
  cleanupErrorMessage,
  operationSession,
  persistOperationSession,
  recoverySaveErrorMessage,
  removeOperationSessionRecovery,
  setOperationMessage,
  capabilityRun,
}: {
  readonly cleanupErrorMessage: string;
  readonly operationSession: CanvasOperationSessionV1 | undefined;
  readonly persistOperationSession: (
    session: CanvasOperationSessionV1,
  ) => Promise<void>;
  readonly recoverySaveErrorMessage: string;
  readonly removeOperationSessionRecovery: (sessionId: string) => Promise<void>;
  readonly setOperationMessage: Dispatch<SetStateAction<string | undefined>>;
  readonly capabilityRun: CapabilityRunDetails | undefined;
}): void {
  useEffect(() => {
    if (
      !capabilityRun ||
      !operationSession ||
      operationSession.phase !== "running" ||
      !terminalCapabilityRunStatuses.has(capabilityRun.lifecycleStatus)
    ) {
      return;
    }
    const reconciled = reconcileCanvasOperationRunV1(
      operationSession,
      capabilityRun,
    );
    void persistOperationSession(reconciled)
      .then(() => {
        setOperationMessage((current) =>
          canvasOperationMessageAfterRunReconcileV1(current, reconciled.phase),
        );
      })
      .catch(() => {
        setOperationMessage(recoverySaveErrorMessage);
      });
  }, [
    operationSession,
    persistOperationSession,
    recoverySaveErrorMessage,
    setOperationMessage,
    capabilityRun,
  ]);

  useEffect(() => {
    if (operationSession?.phase !== "cancelled") {
      return;
    }
    void removeOperationSessionRecovery(operationSession.id).catch(() => {
      setOperationMessage(cleanupErrorMessage);
    });
  }, [
    cleanupErrorMessage,
    operationSession,
    removeOperationSessionRecovery,
    setOperationMessage,
  ]);
}
