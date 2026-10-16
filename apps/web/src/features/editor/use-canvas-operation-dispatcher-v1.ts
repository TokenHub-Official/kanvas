import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  ApiProblem,
  cancelCapabilityRun,
  createCanvasCapabilityRun,
} from "../../api/transport.js";
import {
  canvasOperationStartFailureMessageV1,
  markCanvasOperationFailedV1,
  markCanvasOperationRunningV1,
  requestCanvasOperationCancellationV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";

const forbiddenStatus = 403;

export function useCanvasOperationDispatcherV1({
  cancelPendingMessage,
  csrfToken,
  dispatchingOperationIdsRef,
  pendingCancellationIdsRef,
  persistOperationSession,
  setOperationMessage,
  workspaceId,
}: {
  readonly cancelPendingMessage: string;
  readonly csrfToken: string;
  readonly dispatchingOperationIdsRef: RefObject<Set<string>>;
  readonly pendingCancellationIdsRef: RefObject<Set<string>>;
  readonly persistOperationSession: (
    session: CanvasOperationSessionV1,
  ) => Promise<void>;
  readonly setOperationMessage: Dispatch<SetStateAction<string | undefined>>;
  readonly workspaceId: string;
}) {
  const queryClient = useQueryClient();

  return useCallback(
    async (session: CanvasOperationSessionV1): Promise<void> => {
      if (dispatchingOperationIdsRef.current.has(session.id)) {
        return;
      }
      dispatchingOperationIdsRef.current.add(session.id);
      try {
        const sourceValue =
          session.sourceValue === "artifact_reference"
            ? {
                kind: "artifact" as const,
                artifactId: session.source.artifactId,
              }
            : session.source.artifactId;
        const run = await createCanvasCapabilityRun(
          {
            csrfToken,
            workspaceId,
          },
          {
            contractRevisionId: session.contractRevisionId,
            input: {
              ...session.parameters,
              [session.sourceParameterKey]: sourceValue,
            },
          },
          session.idempotencyKey,
        );
        let running = markCanvasOperationRunningV1(session, run.id);
        await persistOperationSession(running);
        const pendingCancellation = pendingCancellationIdsRef.current.delete(
          session.id,
        );
        if (session.cancelRequested || pendingCancellation) {
          if (!running.cancelRequested) {
            running = requestCanvasOperationCancellationV1(running);
            await persistOperationSession(running);
          }
          try {
            await cancelCapabilityRun(
              {
                csrfToken,
                workspaceId,
              },
              run.id,
              `canvas-cancel:${session.id}`,
            );
          } catch {
            setOperationMessage(cancelPendingMessage);
          }
        }
      } catch (error) {
        if (error instanceof ApiProblem && error.status === forbiddenStatus) {
          void queryClient.invalidateQueries({
            queryKey: ["authentication", "current-human-context"],
          });
        }
        await persistOperationSession(
          markCanvasOperationFailedV1(session, {
            code: "canvas_operation_start_failed",
            message: canvasOperationStartFailureMessageV1(error),
            retryable: true,
          }),
        );
      } finally {
        dispatchingOperationIdsRef.current.delete(session.id);
      }
    },
    [
      cancelPendingMessage,
      csrfToken,
      dispatchingOperationIdsRef,
      pendingCancellationIdsRef,
      persistOperationSession,
      queryClient,
      setOperationMessage,
      workspaceId,
    ],
  );
}
