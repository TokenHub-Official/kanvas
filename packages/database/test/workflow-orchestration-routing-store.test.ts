import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

import { createWorkflowOrchestrationRoutingStore } from "../src/runtime/workflow-orchestration-routing-store.js";
import type { WorkflowOrchestrationRoutingError } from "../src/runtime/workflow-orchestration-routing-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

describe("Workflow orchestration routing store", () => {
  it("reads protocol v1 from the durable execution plan", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          workflowRunId: id(1),
          workspaceId: id(2),
          lifecycleStatus: "running",
          cancelReasonCode: null,
          executionPlanSnapshot: JSON.stringify({
            schemaVersion: 1,
          }),
        },
      ],
      [],
    ]);
    const pool = { execute } as unknown as Pool;

    await expect(
      createWorkflowOrchestrationRoutingStore(pool).read(id(2), id(1)),
    ).resolves.toEqual({
      workflowRunId: id(1),
      workspaceId: id(2),
      protocolVersion: 1,
      lifecycleStatus: "running",
      cancelReasonCode: null,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id = ?"),
      [id(1), id(2)],
    );
  });

  it.each([0, 2, 3])(
    "fails closed for execution-plan protocol %s",
    async (schemaVersion) => {
      const pool = {
        execute: () =>
          Promise.resolve([
            [
              {
                workflowRunId: id(1),
                workspaceId: id(2),
                lifecycleStatus: "running",
                cancelReasonCode: null,
                executionPlanSnapshot: {
                  schemaVersion,
                },
              },
            ],
            [],
          ]),
      } as unknown as Pool;

      await expect(
        createWorkflowOrchestrationRoutingStore(pool).read(id(2), id(1)),
      ).rejects.toMatchObject({
        code: "workflow_routing.plan_invalid",
      } satisfies Partial<WorkflowOrchestrationRoutingError>);
    },
  );
});
