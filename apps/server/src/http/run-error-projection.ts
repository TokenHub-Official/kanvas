const stableCodePattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const opaqueRequestIdPattern = /^[\x21-\x7e]{1,512}$/u;
const maximumCauseDepth = 4;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function matchingString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function businessRunError(error: unknown, depth: number): unknown {
  if (error === null || error === undefined) return error;
  const value = record(error);
  if (!value) return Object.freeze({ code: "run.failed" });
  const code = matchingString(value.code, stableCodePattern) ?? "run.failed";
  const externalState =
    code === "attempt.execution_deadline_expired" &&
    (value.externalState === "unknown" || value.externalState === "not_started")
      ? value.externalState
      : undefined;
  const remoteStatus =
    code === "provider.output_materialization_failed" &&
    value.remoteStatus === "succeeded"
      ? "succeeded"
      : undefined;
  const failureStage =
    code === "provider.output_materialization_failed" &&
    value.failureStage === "result_storage"
      ? "result_storage"
      : undefined;
  const capabilityRunId = matchingString(value.capabilityRunId, ulidPattern);
  const requestId = matchingString(value.requestId, opaqueRequestIdPattern);
  const upstreamRequestId = matchingString(
    record(value.upstream)?.requestId,
    opaqueRequestIdPattern,
  );
  const cause =
    depth < maximumCauseDepth && value.cause !== undefined
      ? businessRunError(value.cause, depth + 1)
      : undefined;
  return Object.freeze({
    code,
    ...(externalState ? { externalState } : {}),
    ...(remoteStatus ? { remoteStatus } : {}),
    ...(failureStage ? { failureStage } : {}),
    ...(capabilityRunId ? { capabilityRunId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(upstreamRequestId
      ? { upstream: Object.freeze({ requestId: upstreamRequestId }) }
      : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function projectRunError(
  error: unknown,
  canReadDiagnostics: boolean,
): unknown {
  return canReadDiagnostics ? error : businessRunError(error, 0);
}
