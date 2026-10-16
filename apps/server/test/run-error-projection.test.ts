import { describe, expect, it } from "vitest";

import { projectRunError } from "../src/http/run-error-projection.js";

const capabilityRunId = "01K00000000000000000000001";
const diagnosticError = {
  code: "capability.failed",
  capabilityRunId,
  cause: {
    code: "provider.remote_invalid_request",
    upstream: {
      statusCode: 400,
      requestId: "provider-request-123",
      body: '{"message":"private prompt","filename":"brief.png","api_key":"credential-value","url":"https://provider.example/task?token=secret"}',
    },
    observedAt: "2026-09-15T10:00:00.000Z",
    retryability: "terminal",
  },
};

describe("Run error projection", () => {
  it("keeps only business codes and correlation identity for a runner", () => {
    const projected = projectRunError(diagnosticError, false);

    expect(projected).toEqual({
      code: "capability.failed",
      capabilityRunId,
      cause: {
        code: "provider.remote_invalid_request",
        upstream: { requestId: "provider-request-123" },
      },
    });
    expect(JSON.stringify(projected)).not.toContain("private prompt");
    expect(JSON.stringify(projected)).not.toContain("brief.png");
    expect(JSON.stringify(projected)).not.toContain("credential-value");
    expect(JSON.stringify(projected)).not.toContain("provider.example");
    expect(JSON.stringify(projected)).not.toContain("statusCode");
    expect(JSON.stringify(projected)).not.toContain("retryability");
  });

  it("preserves the bounded diagnostic for an audit reader", () => {
    expect(projectRunError(diagnosticError, true)).toBe(diagnosticError);
  });
});

it("keeps bounded result uncertainty for a runner without exposing upstream data", () => {
  expect(
    projectRunError(
      {
        code: "attempt.execution_deadline_expired",
        externalState: "unknown",
        message: "private implementation detail",
        upstream: {
          requestId: "safe-request-id",
          body: "private prompt and credential",
        },
      },
      false,
    ),
  ).toEqual({
    code: "attempt.execution_deadline_expired",
    externalState: "unknown",
    upstream: { requestId: "safe-request-id" },
  });
});

it("keeps the bounded result-storage stage when remote success is known", () => {
  expect(
    projectRunError(
      {
        code: "provider.output_materialization_failed",
        remoteStatus: "succeeded",
        failureStage: "result_storage",
      },
      false,
    ),
  ).toEqual({
    code: "provider.output_materialization_failed",
    remoteStatus: "succeeded",
    failureStage: "result_storage",
  });
});
