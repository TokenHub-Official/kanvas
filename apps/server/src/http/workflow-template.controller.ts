import {
  Controller,
  Header,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  ApplicationRuntime,
  WorkflowTemplate as ApplicationWorkflowTemplate,
} from "@kanvas/application";
import {
  getWorkflowTemplateRoute,
  listWorkflowTemplatesRoute,
  WorkflowTemplateListQuerySchema,
  WorkflowTemplatePathSchema,
  type WorkflowTemplate,
  type WorkflowTemplateList,
  type WorkflowTemplateListQuery,
} from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";

import { APPLICATION_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function toTemplate(value: ApplicationWorkflowTemplate): WorkflowTemplate {
  return {
    ...value,
    publishedAt: value.publishedAt.toISOString(),
  };
}

@Controller()
export class WorkflowTemplateController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listWorkflowTemplatesRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkflowTemplateListQuerySchema))
    query: WorkflowTemplateListQuery,
  ): Promise<WorkflowTemplateList> {
    const { scope } = this.contexts.require(request);
    const items = await this.runtime.workflowCatalog.list(scope, {
      ...(query.q ? { query: query.q } : {}),
      ...(query.category ? { category: query.category } : {}),
      includeUnavailable: query.includeUnavailable === "true",
    });
    return {
      items: items.map(toTemplate),
      categories: [
        ...new Set(
          items.flatMap((item) => {
            const category = item.presentation?.category ?? item.category;
            return category ? [category] : [];
          }),
        ),
      ].sort(),
    };
  }

  @ContractRoute(getWorkflowTemplateRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowTemplatePathSchema))
    params: { readonly workflowRevisionId: string },
  ): Promise<WorkflowTemplate> {
    const { scope } = this.contexts.require(request);
    return toTemplate(
      await this.runtime.workflowCatalog.get(scope, params.workflowRevisionId),
    );
  }
}
