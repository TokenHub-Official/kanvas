import { Body, Controller, Inject, UseGuards } from "@nestjs/common";
import {
  ValidateWorkflowTopologyBodySchema,
  validateWorkflowTopologyRoute,
} from "@kanvas/contracts/api";
import type {
  ValidateWorkflowTopologyResult,
  WorkflowTopology,
} from "@kanvas/contracts/workflow";

import { APPLICATION_RUNTIME } from "../tokens.js";
import type { ApplicationRuntime } from "@kanvas/application";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

@Controller()
export class WorkflowTopologyController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
  ) {}

  @ContractRoute(validateWorkflowTopologyRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async validate(
    @Body(new ContractBodyPipe(ValidateWorkflowTopologyBodySchema))
    topology: WorkflowTopology,
  ): Promise<ValidateWorkflowTopologyResult> {
    return this.runtime.workflow.validateTopology({ topology });
  }
}
