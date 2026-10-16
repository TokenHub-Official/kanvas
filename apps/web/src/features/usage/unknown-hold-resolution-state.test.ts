import { describe, expect, it } from "vitest";

import {
  initialUnknownHoldResolutionState,
  reduceUnknownHoldResolution,
} from "./unknown-hold-resolution-state.js";

describe("reduceUnknownHoldResolution", () => {
  it("requests discard confirmation for a dirty draft", () => {
    const dirty = {
      ...initialUnknownHoldResolutionState,
      evidenceReference: "provider-log-1",
      open: true,
    };

    expect(
      reduceUnknownHoldResolution(dirty, { type: "request_close" }),
    ).toMatchObject({
      discardRequested: true,
      open: true,
    });
  });

  it("clears charged amount and its error when released is selected", () => {
    const charged = {
      ...initialUnknownHoldResolutionState,
      chargedAmount: "3.00",
      fieldErrors: {
        ...initialUnknownHoldResolutionState.fieldErrors,
        chargedAmount: "Invalid",
      },
      resolution: "charged" as const,
    };

    expect(
      reduceUnknownHoldResolution(charged, {
        type: "resolution_changed",
        resolution: "not_charged",
      }),
    ).toMatchObject({
      chargedAmount: "",
      fieldErrors: { chargedAmount: undefined },
      resolution: "not_charged",
    });
  });

  it("preserves the locally resolved guard when clearing the form", () => {
    const resolved = reduceUnknownHoldResolution(
      {
        ...initialUnknownHoldResolutionState,
        evidenceReference: "provider-log-1",
        open: true,
      },
      { type: "resolved" },
    );

    expect(resolved).toEqual({
      ...initialUnknownHoldResolutionState,
      locallyResolved: true,
    });
  });
});
