import { describe, expect, it } from "vitest";

import {
  canvasDraftAutosaveAllowedV1,
  canvasDraftInitialCreationAllowedV1,
} from "./use-canvas-draft-autosave-v1.js";

describe("canvas draft save scheduling", () => {
  it("creates only an editable draft without an existing request", () => {
    expect(
      canvasDraftInitialCreationAllowedV1({
        canEdit: true,
        initialCreationRequested: false,
        initialDraftExists: false,
      }),
    ).toBe(true);

    for (const blocked of [
      {
        canEdit: false,
        initialCreationRequested: false,
        initialDraftExists: false,
      },
      {
        canEdit: true,
        initialCreationRequested: true,
        initialDraftExists: false,
      },
      {
        canEdit: true,
        initialCreationRequested: false,
        initialDraftExists: true,
      },
    ]) {
      expect(canvasDraftInitialCreationAllowedV1(blocked)).toBe(false);
    }
  });

  it("autosaves only dirty, conflict-free drafts with settled uploads", () => {
    expect(
      canvasDraftAutosaveAllowedV1({
        canEdit: true,
        fingerprintMatchesSaved: false,
        pendingUploadCount: 0,
        saveConflictActive: false,
      }),
    ).toBe(true);

    for (const blocked of [
      {
        canEdit: false,
        fingerprintMatchesSaved: false,
        pendingUploadCount: 0,
        saveConflictActive: false,
      },
      {
        canEdit: true,
        fingerprintMatchesSaved: true,
        pendingUploadCount: 0,
        saveConflictActive: false,
      },
      {
        canEdit: true,
        fingerprintMatchesSaved: false,
        pendingUploadCount: 1,
        saveConflictActive: false,
      },
      {
        canEdit: true,
        fingerprintMatchesSaved: false,
        pendingUploadCount: 0,
        saveConflictActive: true,
      },
    ]) {
      expect(canvasDraftAutosaveAllowedV1(blocked)).toBe(false);
    }
  });
});
