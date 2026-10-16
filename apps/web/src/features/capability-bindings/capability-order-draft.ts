import type { CapabilityBindingSummary } from "@kanvas/contracts/api";

import type { PendingCapabilityOrderMove } from "./capability-bindings-runtime.js";

export interface CapabilityOrderDraft {
  readonly bindings: readonly CapabilityBindingSummary[];
  readonly editing: boolean;
  readonly moves: readonly PendingCapabilityOrderMove[];
}

type CapabilityOrderDraftAction =
  | {
      readonly type: "move";
      readonly direction: "earlier" | "later";
      readonly index: number;
    }
  | {
      readonly type: "reset";
      readonly bindings: readonly CapabilityBindingSummary[];
    }
  | {
      readonly type: "start";
      readonly bindings: readonly CapabilityBindingSummary[];
    };

export function createCapabilityOrderDraft(
  bindings: readonly CapabilityBindingSummary[],
): CapabilityOrderDraft {
  return { bindings, editing: false, moves: [] };
}

export function reduceCapabilityOrderDraft(
  state: CapabilityOrderDraft,
  action: CapabilityOrderDraftAction,
): CapabilityOrderDraft {
  switch (action.type) {
    case "start":
      return { bindings: action.bindings, editing: true, moves: [] };
    case "reset":
      return createCapabilityOrderDraft(action.bindings);
    case "move": {
      const adjacentIndex =
        action.direction === "earlier" ? action.index - 1 : action.index + 1;
      const binding = state.bindings[action.index];
      const adjacent = state.bindings[adjacentIndex];
      if (!binding || !adjacent) {
        return state;
      }
      const bindings = [...state.bindings];
      bindings[action.index] = adjacent;
      bindings[adjacentIndex] = binding;
      return {
        ...state,
        bindings,
        moves: [
          ...state.moves,
          {
            bindingId: binding.id,
            adjacentBindingId: adjacent.id,
            direction: action.direction,
          },
        ],
      };
    }
  }
}
