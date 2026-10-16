import {
  AgentHubAgentReadQuerySchema,
  ResourceStateListPathSchema,
  ChangeResourceStateBodySchema,
  listResourceStatesRoute,
  changeResourceStateRoute,
  type ResourceStateListPath,
  type ChangeResourceStateBody,
} from "@kanvas/contracts/api";
import {
  Body,
  Controller,
  Headers,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type {
  AgentHubAgent,
  AgentHubAgentDetail,
  AgentHubAgents,
  AgentHubAgentPath,
  AgentHubSkills,
  AgentHubSubjectPath,
  CreateAgentHubAgentBody,
  SetAgentHubVisibilityBody,
  UpdateAgentHubAgentBody,
} from "@kanvas/contracts/api";
import {
  AgentHubAgentPathSchema,
  AgentHubSubjectPathSchema,
  CreateAgentHubAgentBodySchema,
  SetAgentHubVisibilityBodySchema,
  createAgentHubAgentRoute,
  getAgentHubAgentRoute,
  listAgentHubAgentsRoute,
  listAgentHubSkillsRoute,
  setAgentHubVisibilityRoute,
  UpdateAgentHubAgentBodySchema,
  updateAgentHubAgentRoute,
} from "@kanvas/contracts/api";

import { AgentHubService } from "../agent/agent-hub.service.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

@Controller()
export class AgentHubController {
  public constructor(
    private readonly hub: AgentHubService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listResourceStatesRoute)
  @RequireWorkspacePermission("workspace.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public listResourceStates(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(ResourceStateListPathSchema))
    params: ResourceStateListPath,
  ) {
    return this.hub.listResourceStates(
      this.contexts.require(request).scope,
      params.subjectKind,
    );
  }
  @ContractRoute(changeResourceStateRoute)
  @RequireWorkspacePermission("workspace.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async changeResourceState(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentHubSubjectPathSchema))
    params: AgentHubSubjectPath,
    @Body(new ContractBodyPipe(ChangeResourceStateBodySchema))
    body: ChangeResourceStateBody,
  ): Promise<null> {
    await this.hub.changeResourceState(
      this.contexts.require(request).scope,
      params.subjectKind,
      params.subjectId,
      body,
    );
    return null;
  }
  @ContractRoute(listAgentHubAgentsRoute)
  @RequireWorkspacePermission("agent.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public listAgents(@Req() request: FastifyRequest): Promise<AgentHubAgents> {
    return this.hub.listAgents(
      this.contexts.require(request).scope,
      new Date(),
    );
  }

  @ContractRoute(createAgentHubAgentRoute)
  @RequireWorkspacePermission("agent.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public createAgent(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateAgentHubAgentBodySchema))
    body: CreateAgentHubAgentBody,
  ): Promise<AgentHubAgent> {
    return this.hub.createAgent({
      authority: this.contexts.require(request).scope,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(getAgentHubAgentRoute)
  @RequireWorkspacePermission("agent.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getAgent(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentHubAgentPathSchema))
    params: AgentHubAgentPath,
    @Query(new ContractBodyPipe(AgentHubAgentReadQuerySchema))
    query: { threadId?: string },
  ): Promise<AgentHubAgentDetail> {
    return this.hub.getAgent({
      authority: this.contexts.require(request).scope,
      agentDefinitionId: params.agentDefinitionId,
      ...(query.threadId ? { threadId: query.threadId } : {}),
      now: new Date(),
    });
  }

  @ContractRoute(updateAgentHubAgentRoute)
  @RequireWorkspacePermission("agent.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public updateAgent(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentHubAgentPathSchema))
    params: AgentHubAgentPath,
    @Body(new ContractBodyPipe(UpdateAgentHubAgentBodySchema))
    body: UpdateAgentHubAgentBody,
  ): Promise<AgentHubAgentDetail> {
    return this.hub.updateAgent({
      authority: this.contexts.require(request).scope,
      agentDefinitionId: params.agentDefinitionId,
      body,
      now: new Date(),
    });
  }

  @ContractRoute(listAgentHubSkillsRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public listSkills(@Req() request: FastifyRequest): Promise<AgentHubSkills> {
    return this.hub.listSkills(
      this.contexts.require(request).scope,
      new Date(),
    );
  }

  @ContractRoute(setAgentHubVisibilityRoute)
  @RequireWorkspacePermission("workspace.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async setVisibility(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentHubSubjectPathSchema))
    params: AgentHubSubjectPath,
    @Body(new ContractBodyPipe(SetAgentHubVisibilityBodySchema))
    body: SetAgentHubVisibilityBody,
  ): Promise<null> {
    await this.hub.setVisibility({
      authority: this.contexts.require(request).scope,
      subjectKind: params.subjectKind,
      subjectId: params.subjectId,
      expectedVersion: body.expectedVersion,
      visibility: body.visibility,
      now: new Date(),
    });
    return null;
  }
}
