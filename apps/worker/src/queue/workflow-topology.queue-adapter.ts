import { Inject, Injectable } from "@nestjs/common";
import type { ApplicationRuntime } from "@kanvas/application";
import {
  WorkflowTopologyValidationJobSchema,
  type WorkflowTopologyValidationJob,
} from "@kanvas/contracts/events";
import type { ValidateWorkflowTopologyResult } from "@kanvas/contracts/workflow";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import { APPLICATION_RUNTIME } from "../tokens.js";

export const ORCHESTRATION_QUEUE = "kanvas-orchestration";
export const WORKFLOW_TOPOLOGY_VALIDATION_JOB =
  "foundation.workflow-topology.validate";

@Injectable()
export class WorkflowTopologyQueueAdapter {
  readonly #validatePayload: ValidateFunction<WorkflowTopologyValidationJob>;

  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
  ) {
    const ajv = new Ajv2020({
      strict: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    this.#validatePayload = ajv.compile(WorkflowTopologyValidationJobSchema);
  }

  public async handle(
    payload: unknown,
  ): Promise<ValidateWorkflowTopologyResult> {
    if (!this.#validatePayload(payload)) {
      throw new Error("Invalid workflow topology validation job payload.");
    }

    await this.runtime.runtimeFence.assertAllowed({
      action: "claim",
      expectedGeneration: payload.expectedGeneration,
    });
    return this.runtime.workflow.validateTopology({
      topology: payload.topology,
    });
  }
}
