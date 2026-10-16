import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  removeCanvasOperationSessionV1,
  saveCanvasOperationSessionV1,
} from "./canvas-operation-recovery-v1.js";
import {
  isCanvasOperationFinalizationPhaseV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";

export function useCanvasOperationSessionStorageV1({
  fallbackRecoveryIdRef,
  finalizingOperationIdsRef,
  recoveryIdRef,
  setOperationSession,
  workspaceId,
}: {
  readonly fallbackRecoveryIdRef: RefObject<string>;
  readonly finalizingOperationIdsRef: RefObject<Set<string>>;
  readonly recoveryIdRef: RefObject<string>;
  readonly setOperationSession: Dispatch<
    SetStateAction<CanvasOperationSessionV1 | undefined>
  >;
  readonly workspaceId: string;
}) {
  const persistOperationSession = useCallback(
    async (session: CanvasOperationSessionV1): Promise<void> => {
      if (
        finalizingOperationIdsRef.current.has(session.id) &&
        !isCanvasOperationFinalizationPhaseV1(session.phase)
      ) {
        return;
      }
      setOperationSession(session);
      await Promise.all(
        operationRecoveryIds(
          recoveryIdRef.current,
          fallbackRecoveryIdRef.current,
        ).map((recoveryId) =>
          saveCanvasOperationSessionV1({
            workspaceId,
            recoveryId,
            session,
          }),
        ),
      );
    },
    [
      fallbackRecoveryIdRef,
      finalizingOperationIdsRef,
      recoveryIdRef,
      setOperationSession,
      workspaceId,
    ],
  );

  const removeOperationSessionRecovery = useCallback(
    async (sessionId: string): Promise<void> => {
      await Promise.all(
        operationRecoveryIds(
          recoveryIdRef.current,
          fallbackRecoveryIdRef.current,
        ).map((recoveryId) =>
          removeCanvasOperationSessionV1(workspaceId, recoveryId, sessionId),
        ),
      );
    },
    [fallbackRecoveryIdRef, recoveryIdRef, workspaceId],
  );

  return {
    persistOperationSession,
    removeOperationSessionRecovery,
  };
}

export function operationRecoveryIds(
  recoveryId: string,
  fallbackRecoveryId: string,
): readonly string[] {
  return [...new Set([recoveryId, fallbackRecoveryId])];
}
