import type { CanvasDraft } from "@kanvas/contracts/api";
import { useCallback, useReducer, useRef, useState } from "react";

import type { CanvasSaveStatusV1 } from "./canvas-workspace-view-model-v1.js";

export interface CanvasDraftRuntimeV1 {
  readonly id?: string;
  readonly lastSavedFingerprint: string;
  readonly version?: number;
}

export interface CanvasSaveConflictStateV1 {
  readonly active: boolean;
  readonly draft?: CanvasDraft;
  readonly error?: string;
  readonly open: boolean;
  readonly resolving?: "keep_local" | "use_latest";
}

export type CanvasSaveConflictActionV1 =
  | { readonly type: "activate" }
  | { readonly type: "begin_latest_load" }
  | {
      readonly type: "begin_resolution";
      readonly resolution: "keep_local" | "use_latest";
    }
  | { readonly type: "clear" }
  | { readonly type: "close_dialog" }
  | { readonly type: "finish_resolution" }
  | { readonly type: "latest_failed"; readonly error: string }
  | { readonly type: "latest_loaded"; readonly draft: CanvasDraft };

const inactiveSaveConflict: CanvasSaveConflictStateV1 = {
  active: false,
  open: false,
};

export function canvasSaveConflictReducerV1(
  state: CanvasSaveConflictStateV1,
  action: CanvasSaveConflictActionV1,
): CanvasSaveConflictStateV1 {
  if (action.type === "activate") {
    return {
      ...state,
      active: true,
      open: true,
    };
  }
  if (action.type === "begin_latest_load") {
    return {
      active: state.active,
      open: state.open,
      ...(state.resolving ? { resolving: state.resolving } : {}),
    };
  }
  if (action.type === "latest_loaded") {
    return {
      ...state,
      draft: action.draft,
    };
  }
  if (action.type === "latest_failed") {
    return {
      ...state,
      error: action.error,
    };
  }
  if (action.type === "begin_resolution") {
    return {
      ...state,
      resolving: action.resolution,
    };
  }
  if (action.type === "finish_resolution") {
    return {
      active: state.active,
      open: state.open,
      ...(state.draft ? { draft: state.draft } : {}),
      ...(state.error ? { error: state.error } : {}),
    };
  }
  if (action.type === "close_dialog") {
    return {
      ...state,
      open: false,
    };
  }
  return inactiveSaveConflict;
}

export function useCanvasDraftPersistenceStateV1({
  initialDraft,
  initialFingerprint,
}: {
  readonly initialDraft: CanvasDraft | undefined;
  readonly initialFingerprint: string;
}) {
  const [saveStatus, setSaveStatus] = useState<CanvasSaveStatusV1>(
    initialDraft ? "saved" : "idle",
  );
  const [draftSaveError, setDraftSaveError] = useState<string>();
  const [saveConflict, dispatchSaveConflict] = useReducer(
    canvasSaveConflictReducerV1,
    inactiveSaveConflict,
  );
  const [draftRuntime, setDraftRuntime] = useState<CanvasDraftRuntimeV1>(
    () => ({
      ...(initialDraft ? { id: initialDraft.id } : {}),
      lastSavedFingerprint: initialFingerprint,
      ...(initialDraft ? { version: initialDraft.version } : {}),
    }),
  );
  const draftIdRef = useRef(draftRuntime.id);
  const draftVersionRef = useRef(draftRuntime.version);
  const lastSavedFingerprintRef = useRef(draftRuntime.lastSavedFingerprint);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const updateDraftRuntime = useCallback(
    (update: Partial<CanvasDraftRuntimeV1>): void => {
      if (update.id !== undefined) {
        draftIdRef.current = update.id;
      }
      if (update.version !== undefined) {
        draftVersionRef.current = update.version;
      }
      if (update.lastSavedFingerprint !== undefined) {
        lastSavedFingerprintRef.current = update.lastSavedFingerprint;
      }
      setDraftRuntime((current) => ({
        ...current,
        ...update,
      }));
    },
    [],
  );

  return {
    dispatchSaveConflict,
    draftIdRef,
    draftRuntime,
    draftSaveError,
    draftVersionRef,
    lastSavedFingerprintRef,
    saveConflict,
    saveQueueRef,
    saveStatus,
    setDraftSaveError,
    setSaveStatus,
    updateDraftRuntime,
  };
}
