import type { WorkflowTopologyV1 } from "@kanvas/contracts/workflow";
import { describe, expect, it } from "vitest";

import {
  assertStableMapScopeKey,
  BoundedWorkflowRuntimeError,
  evaluateBoundedJoin,
  topologicallyOrderWorkflowNodes,
} from "../src/runtime/bounded-workflow-orchestrator-store.js";

describe("bounded Workflow v1 pure frontier rules", () => {
  it("waits only for resolved potential inputs and activated edges", () => {
    expect(
      evaluateBoundedJoin({
        isEntry: false,
        allPotentialIncomingResolved: false,
        activatedSourceStatuses: ["completed"],
        joinPolicy: "all_success",
      }),
    ).toBe("wait");
    expect(
      evaluateBoundedJoin({
        isEntry: false,
        allPotentialIncomingResolved: true,
        activatedSourceStatuses: [],
        joinPolicy: "all_success",
      }),
    ).toBe("skip_branch_not_selected");
  });

  it("distinguishes all_success from all_settled", () => {
    expect(
      evaluateBoundedJoin({
        isEntry: false,
        allPotentialIncomingResolved: true,
        activatedSourceStatuses: ["completed", "failed"],
        joinPolicy: "all_success",
      }),
    ).toBe("skip_upstream_not_successful");
    expect(
      evaluateBoundedJoin({
        isEntry: false,
        allPotentialIncomingResolved: true,
        activatedSourceStatuses: ["completed", "failed"],
        joinPolicy: "all_settled",
      }),
    ).toBe("ready");
  });

  it("accepts stable map scopes and rejects root or unsafe values", () => {
    expect(assertStableMapScopeKey("deliverable-item:01KABC")).toBe(
      "deliverable-item:01KABC",
    );
    for (const value of ["root", "", "contains space", "../escape"]) {
      expect(() => assertStableMapScopeKey(value)).toThrow(
        BoundedWorkflowRuntimeError,
      );
    }
  });

  it("uses a stable topological order across switch alternatives and joins", () => {
    const topology = {
      schemaVersion: 1,
      key: "order",
      entryNodeKey: "start",
      limits: {
        maxNodeRuns: 10,
        timeoutMs: 60_000,
      },
      nodes: [
        {
          key: "join",
          kind: "approval",
          joinPolicy: "all_settled",
          request: {},
          decisionSchema: {
            type: "object",
          },
          next: [],
        },
        {
          key: "start",
          kind: "switch",
          value: true,
          cases: [
            {
              when: {
                operator: "equals",
                value: true,
              },
              next: ["left"],
            },
          ],
          defaultNext: ["right"],
        },
        {
          key: "right",
          kind: "approval",
          request: {},
          decisionSchema: {
            type: "object",
          },
          next: ["join"],
        },
        {
          key: "left",
          kind: "approval",
          request: {},
          decisionSchema: {
            type: "object",
          },
          next: ["join"],
        },
      ],
      outputs: {},
    } satisfies WorkflowTopologyV1;

    expect(
      topologicallyOrderWorkflowNodes(topology).map(({ key }) => key),
    ).toEqual(["start", "right", "left", "join"]);
  });
});
