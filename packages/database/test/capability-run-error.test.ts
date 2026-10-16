import { expect, it } from "vitest";
import { capabilityRunError } from "../src/runtime/capability-run-store.js";
it("preserves remote output-delivery failure instead of mislabeling it as generation timeout", () => {
  expect(
    capabilityRunError(
      { code: "attempt.execution_deadline_expired", externalState: "unknown" },
      true,
    ),
  ).toMatchObject({
    code: "provider.output_materialization_failed",
    remoteStatus: "succeeded",
    failureStage: "result_storage",
  });
});
it("does not infer remote success without an adopted materialization failure", () => {
  expect(
    capabilityRunError({ code: "attempt.execution_deadline_expired" }, false),
  ).toEqual({ code: "attempt.execution_deadline_expired" });
  expect(capabilityRunError(null, false)).toBeUndefined();
});

it("does not replace a later specific failure with historical delivery trouble", () => {
  expect(
    capabilityRunError({ code: "provider.remote_invalid_request" }, true),
  ).toEqual({ code: "provider.remote_invalid_request" });
});
