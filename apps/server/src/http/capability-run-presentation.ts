import type { CapabilityRunDetails } from "@kanvas/contracts/api";
import type { CapabilityRunService } from "../capabilities/capability-run.service.js";
import { projectRunError } from "./run-error-projection.js";

export function capabilityRunDetails(
  run: Awaited<ReturnType<CapabilityRunService["get"]>>,
  canReadDiagnostics: boolean,
): CapabilityRunDetails {
  return {
    id: run.id,
    contractRevisionId: run.contractRevisionId,
    invocationKind: run.invocationKind,
    lifecycleStatus: run.lifecycleStatus,
    input: run.input,
    ...(run.inputDeclarations
      ? { inputDeclarations: [...run.inputDeclarations] }
      : {}),
    ...(run.output === undefined ? {} : { output: run.output }),
    ...(run.externalResultUrls?.length
      ? { externalResultUrls: [...run.externalResultUrls] }
      : {}),
    ...(run.outputDeclarations
      ? { outputDeclarations: [...run.outputDeclarations] }
      : {}),
    ...(run.error
      ? {
          error: projectRunError(run.error, canReadDiagnostics) as Record<
            string,
            unknown
          >,
        }
      : {}),
    ...(run.browserExecution
      ? {
          browserExecution: {
            requiredCapabilityKeys: [
              ...run.browserExecution.requiredCapabilityKeys,
            ],
          },
        }
      : {}),
    version: run.version,
    executionDeadlineAt: run.executionDeadlineAt.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
    ...(run.cancelRequestedAt
      ? { cancelRequestedAt: run.cancelRequestedAt.toISOString() }
      : {}),
  };
}
