import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  getOperationalTimelineRoute,
  WorkflowRunPathSchema,
  type OperationalTimeline,
  listTaskRecordsRoute,
  getTaskTimelineRoute,
  TaskRecordQuerySchema,
  TaskTimelinePathSchema,
  type TaskRecordQuery,
  type TaskRecordList,
  type TaskTimeline,
} from "@kanvas/contracts/api";
import { OperationalTimelineStoreError } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { ContractBodyPipe } from "../http/contract-body.pipe.js";
import { ContractRoute } from "../http/contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "../http/request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "../http/workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "../http/workspace-permission.decorator.js";
import { DATABASE_RUNTIME } from "../tokens.js";

function translate(error: OperationalTimelineStoreError): never {
  if (error.code === "operational_timeline.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "operational_timeline.forbidden") {
    throw new ForbiddenException(error.message);
  }
  throw new NotFoundException("Workflow Run was not found.");
}

@Controller()
export class OperationalTimelineController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listTaskRecordsRoute)
  @RequireWorkspacePermission("audit.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(TaskRecordQuerySchema)) query: TaskRecordQuery,
  ): Promise<TaskRecordList> {
    const { scope } = this.contexts.require(request);
    try {
      return await this.database.operationalTimeline.list({
        authority: scope,
        query,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof OperationalTimelineStoreError) translate(error);
      throw error;
    }
  }

  @ContractRoute(getTaskTimelineRoute)
  @RequireWorkspacePermission("audit.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async taskTimeline(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(TaskTimelinePathSchema))
    params: {
      readonly kind: "workflow" | "capability";
      readonly taskRunId: string;
    },
  ): Promise<TaskTimeline> {
    const { scope } = this.contexts.require(request);
    try {
      const timeline = await this.database.operationalTimeline.get({
        authority: scope,
        workflowRunId: params.taskRunId,
        kind: params.kind,
        now: new Date(),
        limit: 500,
      });
      return {
        taskRunId: params.taskRunId,
        kind: params.kind,
        generatedAt: timeline.generatedAt.toISOString(),
        items: timeline.items.map((item) => ({
          ...item,
          occurredAt: item.occurredAt.toISOString(),
        })),
        truncated: timeline.truncated,
      };
    } catch (error) {
      if (error instanceof OperationalTimelineStoreError) translate(error);
      throw error;
    }
  }

  @ContractRoute(getOperationalTimelineRoute)
  @RequireWorkspacePermission("audit.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowRunPathSchema))
    params: { readonly workflowRunId: string },
  ): Promise<OperationalTimeline> {
    const { scope } = this.contexts.require(request);
    try {
      const timeline = await this.database.operationalTimeline.get({
        authority: scope,
        workflowRunId: params.workflowRunId,
        now: new Date(),
        limit: 500,
      });
      return {
        workflowRunId: timeline.workflowRunId,
        generatedAt: timeline.generatedAt.toISOString(),
        items: timeline.items.map((item) => ({
          ...item,
          occurredAt: item.occurredAt.toISOString(),
        })),
        truncated: timeline.truncated,
      };
    } catch (error) {
      if (error instanceof OperationalTimelineStoreError) {
        translate(error);
      }
      throw error;
    }
  }
}
