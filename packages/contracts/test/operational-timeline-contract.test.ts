import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  getOperationalTimelineRoute,
  listTaskRecordsRoute,
  getTaskTimelineRoute,
  TaskRecordQuerySchema,
  OperationalTimelineSchema,
  routeRegistry,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Operational Timeline API contract", () => {
  it("registers a workspace-scoped authenticated administrator query", () => {
    expect(routeRegistry).toContain(getOperationalTimelineRoute);
    expect(routeRegistry).toContain(listTaskRecordsRoute);
    expect(routeRegistry).toContain(getTaskTimelineRoute);
    const query = createAjv().compile(TaskRecordQuerySchema);
    expect(query({ limit: "101" })).toBe(false);
    expect(
      query({
        status: "failed",
        reference: "01K00000000000000000000001",
        limit: "50",
      }),
    ).toBe(true);
    expect(getOperationalTimelineRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/workflow-runs/{workflowRunId}/operational-timeline",
      security: ["sessionOrServiceToken"],
      idempotency: "none",
    });
    expect(getOperationalTimelineRoute.request?.headers?.required).toContain(
      "x-kanvas-workspace-id",
    );
  });

  it("accepts only bounded flat redacted fact values", () => {
    const validate = createAjv().compile(OperationalTimelineSchema);
    const timeline = {
      workflowRunId: "01K00000000000000000000001",
      generatedAt: "2026-07-28T20:00:00.000Z",
      items: [
        {
          id: "01K00000000000000000000002",
          source: "capability_attempt",
          kind: "attempt.snapshot",
          resourceType: "capability_attempt",
          resourceId: "01K00000000000000000000002",
          status: "completed",
          occurredAt: "2026-07-28T19:59:00.000Z",
          facts: {
            executionTarget: "worker",
            attemptNumber: 1,
            transitionKind: "fallback",
            transitionReasonCode:
              "attempt.transition.fallback.browser_executor_fenced",
            accepted: true,
            providerRequestId: null,
          },
        },
      ],
      truncated: false,
    };

    expect(validate(timeline)).toBe(true);
    expect(
      validate({
        ...timeline,
        items: [
          {
            ...timeline.items[0],
            facts: {
              rawProviderResponse: {
                secret: "must-not-be-projectable",
              },
            },
          },
        ],
      }),
    ).toBe(false);
  });
});
