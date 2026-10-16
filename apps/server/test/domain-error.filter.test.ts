import type { ArgumentsHost } from "@nestjs/common";
import { DomainError } from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import { DomainErrorFilter } from "../src/http/domain-error.filter.js";

function catchDomainError(code: string): {
  readonly status: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({
    send,
  });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status,
      }),
    }),
  } as unknown as ArgumentsHost;

  new DomainErrorFilter().catch(
    new DomainError(code, "Cancellation was rejected."),
    host,
  );
  return {
    status,
    send,
  };
}

describe("DomainErrorFilter cancellation mappings", () => {
  it.each([
    "workflow_run.already_terminal",
    "workflow_run.cancel_conflict",
    "workflow_run.route_unavailable",
  ])("maps %s to an HTTP conflict", (code) => {
    const response = catchDomainError(code);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 409,
        code,
      }),
    );
  });

  it("maps a closed runtime fence to service unavailable", () => {
    const response = catchDomainError("workflow_run.runtime_not_cancellable");

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 503,
        code: "workflow_run.runtime_not_cancellable",
      }),
    );
  });

  it.each([
    ["brand.version_conflict", 409],
    ["brand.publication_required", 409],
    ["brand.revision_not_found", 404],
    ["brand.default_not_found", 404],
    ["brand.not_configured", 503],
    ["brand.invalid_argument", 400],
    ["agent.state_conflict", 409],
    ["agent.identity_conflict", 409],
    ["agent.interaction_not_found", 404],
    ["agent.interaction_invalid", 400],
    ["workflow_approval.already_decided", 409],
    ["workflow_approval.expired", 409],
    ["workflow_approval.not_found", 404],
    ["workflow_approval.forbidden", 403],
    ["workflow_approval.not_configured", 503],
    ["workflow_approval.decision_invalid", 400],
  ])("maps %s to HTTP %i", (code, expectedStatus) => {
    const response = catchDomainError(code);

    expect(response.status).toHaveBeenCalledWith(expectedStatus);
  });
});
