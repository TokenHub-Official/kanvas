import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  CancelWorkflowRunBodySchema,
  CreateWorkflowRunBodySchema,
  cancelWorkflowRunRoute,
  listWorkflowRunsRoute,
  routeRegistry,
  WorkflowRunCancellationAcceptedSchema,
  WorkflowRunAcceptedSchema,
  WorkflowRunDetailsSchema,
  WorkflowRunListQuerySchema,
  WorkflowRunListSchema,
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

describe("workflow run cancellation API contract", () => {
  it("accepts one selected Brand or an explicit no-brand choice", () => {
    const ajv = createAjv();
    const validateCreate = ajv.compile(CreateWorkflowRunBodySchema);
    const validateAccepted = ajv.compile(WorkflowRunAcceptedSchema);
    const body = {
      workflowRevisionId: "01K00000000000000000000000",
      input: { prompt: "活动海报" },
    };
    expect(
      validateCreate({
        ...body,
        brandKitRevisionId: "01K00000000000000000000001",
      }),
    ).toBe(true);
    expect(validateCreate({ ...body, brandKitRevisionId: null })).toBe(true);
    expect(
      validateAccepted({
        id: "01K00000000000000000000002",
        brand: {
          brandKitId: "01K00000000000000000000003",
          brandKitRevisionId: "01K00000000000000000000001",
          name: "Kanvas 主品牌",
          revisionNumber: 3,
        },
        definitionKind: "published_revision",
        workflowRevisionId: body.workflowRevisionId,
        nonProduction: false,
        lifecycleStatus: "queued",
        outcome: null,
        createdAt: "2026-08-20T05:00:00.000Z",
        replayed: false,
      }),
    ).toBe(true);
  });

  it("registers a principal-scoped recent run query", () => {
    expect(listWorkflowRunsRoute).toMatchObject({
      operationId: "workflowRuns.list",
      method: "GET",
      path: "/api/v1/workflow-runs",
      security: ["sessionOrServiceToken"],
      idempotency: "none",
    });
    expect(routeRegistry).toContain(listWorkflowRunsRoute);
    const ajv = createAjv();
    expect(
      ajv.compile(WorkflowRunListQuerySchema)({
        state: "active",
        limit: "20",
      }),
    ).toBe(true);
    expect(
      ajv.compile(WorkflowRunListSchema)({
        items: [
          {
            id: "01K00000000000000000000001",
            brand: {
              brandKitId: "01K00000000000000000000003",
              brandKitRevisionId: "01K00000000000000000000004",
              name: "Kanvas 主品牌",
              revisionNumber: 3,
            },
            workflowRevisionId: "01K00000000000000000000000",
            displayName: "海报制作",
            lifecycleStatus: "completed",
            outcome: "full_success",
            output: { imageArtifactId: "01K00000000000000000000002" },
            createdAt: "2026-08-20T05:00:00.000Z",
            completedAt: "2026-08-20T05:01:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });

  it("registers a monotonic cancellation command with explicit outcomes", () => {
    expect(cancelWorkflowRunRoute).toMatchObject({
      operationId: "workflowRuns.cancel",
      method: "POST",
      path: "/api/v1/workflow-runs/{workflowRunId}/cancel",
      security: ["sessionOrServiceToken"],
      idempotency: "optional",
    });
    expect(Object.keys(cancelWorkflowRunRoute.responses).map(Number)).toEqual([
      202, 400, 404, 409, 503,
    ]);
    expect(routeRegistry).toContain(cancelWorkflowRunRoute);
  });

  it("accepts only structured cancellation reason codes", () => {
    const validate = createAjv().compile(CancelWorkflowRunBodySchema);

    expect(validate({})).toBe(true);
    expect(validate({ reasonCode: "user_requested" })).toBe(true);
    expect(validate({ reasonCode: "budget_exceeded" })).toBe(true);
    expect(validate({ reasonCode: "free form" })).toBe(false);
    expect(
      validate({
        reasonCode: "user_requested",
        comment: "not part of the durable protocol",
      }),
    ).toBe(false);
  });

  it("validates cancellation acknowledgement and query facts", () => {
    const ajv = createAjv();
    const validateAccepted = ajv.compile(WorkflowRunCancellationAcceptedSchema);
    const validateDetails = ajv.compile(WorkflowRunDetailsSchema);
    const cancellationFacts = {
      cancelRequestedAt: "2026-07-27T12:00:00.000Z",
      cancelReasonCode: "policy_denied",
      cancelDeadlineAt: "2026-07-27T12:00:30.000Z",
    };

    expect(
      validateAccepted({
        id: "01K00000000000000000000000",
        lifecycleStatus: "cancelling",
        version: 4,
        ...cancellationFacts,
        replayed: false,
      }),
    ).toBe(true);
    expect(
      validateDetails({
        id: "01K00000000000000000000000",
        brand: {
          brandKitId: "01K00000000000000000000003",
          brandKitRevisionId: "01K00000000000000000000004",
          name: "Kanvas 主品牌",
          revisionNumber: 3,
        },
        definitionKind: "published_revision",
        workflowRevisionId: "01K00000000000000000000001",
        nonProduction: false,
        lifecycleStatus: "cancelling",
        outcome: null,
        browserExecution: {
          requiredCapabilityKeys: ["browser.image.palette.extract"],
        },
        version: 4,
        input: {},
        output: null,
        nodes: [],
        createdAt: "2026-07-27T11:59:00.000Z",
        updatedAt: "2026-07-27T12:00:00.000Z",
        ...cancellationFacts,
      }),
    ).toBe(true);
    expect(
      validateAccepted({
        id: "01K00000000000000000000000",
        lifecycleStatus: "cancelling",
        version: 0,
        ...cancellationFacts,
        replayed: false,
      }),
    ).toBe(false);
  });
});
