import { describe, expect, it, vi } from "vitest";

import {
  clearWorkflowAuthoringRecovery,
  readWorkflowAuthoringRecovery,
  reconcileWorkflowAuthoringSave,
  writeWorkflowAuthoringRecovery,
  type WorkflowAuthoringRecovery,
} from "./workflow-authoring-recovery.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const recovery: WorkflowAuthoringRecovery = {
  schemaVersion: 1,
  workspaceId: "workspace-1",
  draftId: "draft-1",
  baseDefinitionVersion: 2,
  baseDraftVersion: 3,
  displayName: "Recovered workflow",
  graph: {
    schemaVersion: 1,
    workflowKey: "recovered",
    limits: { maxNodeRuns: 10, timeoutMs: 60_000 },
    nodes: [],
    edges: [],
  },
  presentation: {
    schemaVersion: 1,
    tags: [],
    availability: { standalone: true, canvas: false, directLink: true },
  },
  savedAt: "2026-09-14T12:00:00.000Z",
};

describe("Workflow authoring recovery", () => {
  it("round-trips a versioned local snapshot and clears it after save", () => {
    const target = storage();

    writeWorkflowAuthoringRecovery(recovery, target);
    expect(
      readWorkflowAuthoringRecovery("workspace-1", "draft-1", target),
    ).toEqual(recovery);

    clearWorkflowAuthoringRecovery("workspace-1", "draft-1", target);
    expect(
      readWorkflowAuthoringRecovery("workspace-1", "draft-1", target),
    ).toBeUndefined();
  });

  it("rejects a snapshot scoped to another draft", () => {
    const target = storage();
    writeWorkflowAuthoringRecovery(recovery, target);

    expect(
      readWorkflowAuthoringRecovery("workspace-1", "draft-2", target),
    ).toBeUndefined();
  });

  it("keeps edits made while a save is pending and only clears an unchanged snapshot", () => {
    const submitted = {
      displayName: recovery.displayName,
      graph: recovery.graph,
      presentation: recovery.presentation,
    };
    const savedPresentation = {
      ...recovery.presentation,
      title: "Saved title",
    };

    expect(
      reconcileWorkflowAuthoringSave(
        submitted,
        { ...submitted },
        savedPresentation,
      ),
    ).toEqual({
      clearRecovery: true,
      dirty: false,
      presentation: savedPresentation,
    });

    const editedWhileSaving = {
      ...submitted,
      displayName: "Edited while saving",
      presentation: { ...submitted.presentation, title: "Newer local title" },
    };
    expect(
      reconcileWorkflowAuthoringSave(
        submitted,
        editedWhileSaving,
        savedPresentation,
      ),
    ).toEqual({
      clearRecovery: false,
      dirty: true,
      presentation: editedWhileSaving.presentation,
    });
  });
});
