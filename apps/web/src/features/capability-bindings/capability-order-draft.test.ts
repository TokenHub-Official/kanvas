import type { CapabilityBindingSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  createCapabilityOrderDraft,
  reduceCapabilityOrderDraft,
} from "./capability-order-draft.js";

const bindings = [
  { id: "browser" },
  { id: "provider" },
] as CapabilityBindingSummary[];

describe("reduceCapabilityOrderDraft", () => {
  it("moves a binding and records the matching server operation", () => {
    const editing = reduceCapabilityOrderDraft(
      createCapabilityOrderDraft(bindings),
      { type: "start", bindings },
    );
    const moved = reduceCapabilityOrderDraft(editing, {
      type: "move",
      direction: "later",
      index: 0,
    });

    expect(moved.bindings.map((binding) => binding.id)).toEqual([
      "provider",
      "browser",
    ]);
    expect(moved.moves).toEqual([
      {
        adjacentBindingId: "provider",
        bindingId: "browser",
        direction: "later",
      },
    ]);
  });

  it("resets editing state and pending moves together", () => {
    const dirty = {
      bindings: [...bindings].reverse(),
      editing: true,
      moves: [
        {
          adjacentBindingId: "provider",
          bindingId: "browser",
          direction: "later" as const,
        },
      ],
    };

    expect(
      reduceCapabilityOrderDraft(dirty, { type: "reset", bindings }),
    ).toEqual(createCapabilityOrderDraft(bindings));
  });
});
