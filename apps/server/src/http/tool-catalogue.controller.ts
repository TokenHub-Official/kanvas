import { SiteCoverService } from "../storage/site-cover.service.js";
import { getToolImageRoute } from "@kanvas/contracts/api";
import { toolImageContent } from "../tools/tool-image-content.js";
import {
  Controller,
  ForbiddenException,
  Header,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getToolUsageRoute, listToolsRoute } from "@kanvas/contracts/api";
import { AuthorizationStoreError, SiteToolStoreError } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function mapError(error: unknown): never {
  if (error instanceof AuthorizationStoreError)
    throw new ForbiddenException("Workspace access is no longer available.");
  if (error instanceof SiteToolStoreError)
    throw new NotFoundException("This tool is unavailable.");
  throw error;
}
@Controller()
@UseGuards(WorkspaceAuthorizationGuard)
export class ToolCatalogueController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly covers?: SiteCoverService,
  ) {}
  @ContractRoute(getToolImageRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("workspace.read")
  public async image(
    @Req() request: FastifyRequest,
    @Param("imageId") imageId: string,
  ) {
    try {
      const image = await this.database.siteToolImages.readForUser(
        this.contexts.require(request).scope,
        imageId,
      );
      return toolImageContent(
        this.covers ? await this.covers.materialize(image) : image,
      );
    } catch (error) {
      return mapError(error);
    }
  }
  @ContractRoute(listToolsRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("workspace.read")
  public async list(@Req() request: FastifyRequest) {
    try {
      return {
        items: await this.database.siteTools.catalogue(
          this.contexts.require(request).scope,
        ),
      };
    } catch (error) {
      return mapError(error);
    }
  }
  @ContractRoute(getToolUsageRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("workspace.read")
  public async detail(
    @Req() request: FastifyRequest,
    @Param("slug") slug: string,
  ) {
    try {
      return await this.database.siteTools.usageDetail(
        this.contexts.require(request).scope,
        slug,
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
