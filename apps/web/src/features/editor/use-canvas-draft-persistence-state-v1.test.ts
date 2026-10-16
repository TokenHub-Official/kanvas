import type { CanvasDraft } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  canvasSaveConflictReducerV1,
  type CanvasSaveConflictStateV1,
} from "./use-canvas-draft-persistence-state-v1.js";

const inactive: CanvasSaveConflictStateV1 = {
  active: false,
  open: false,
};

const latestDraft = {
  id: "draft-01",
  version: 2,
} as CanvasDraft;

describe("canvasSaveConflictReducerV1", () => {
  it("preserves an active conflict when its dialog is dismissed", () => {
    const active = canvasSaveConflictReducerV1(inactive, {
      type: "activate",
    });

    expect(
      canvasSaveConflictReducerV1(active, { type: "close_dialog" }),
    ).toEqual({
      active: true,
      open: false,
    });
  });

  it("tracks latest evidence and resolution without splitting state", () => {
    const active = canvasSaveConflictReducerV1(inactive, {
      type: "activate",
    });
    const loaded = canvasSaveConflictReducerV1(active, {
      type: "latest_loaded",
      draft: latestDraft,
    });
    const resolving = canvasSaveConflictReducerV1(loaded, {
      type: "begin_resolution",
      resolution: "keep_local",
    });

    expect(resolving).toMatchObject({
      active: true,
      draft: latestDraft,
      open: true,
      resolving: "keep_local",
    });
    expect(canvasSaveConflictReducerV1(resolving, { type: "clear" })).toEqual(
      inactive,
    );
  });
});
