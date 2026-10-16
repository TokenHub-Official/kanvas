import { SiteCoverService } from "../storage/site-cover.service.js";
import {
  getSiteToolSourceRoute,
  ToolSourceQuerySchema,
  type ToolSourceQuery,
} from "@kanvas/contracts/api";
import {
  listToolIntegrationsRoute,
  ToolIntegrationQuerySchema,
  type ToolIntegrationQuery,
} from "@kanvas/contracts/api";
import {
  UploadToolImageBodySchema,
  type UploadToolImageBody,
  uploadSiteToolImageRoute,
  getSiteToolImageRoute,
} from "@kanvas/contracts/api";
import { normalizeToolImage, ToolImageError } from "../tools/tool-image.js";
import { toolImageContent } from "../tools/tool-image-content.js";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import {
  type CreateSiteToolBody,
  type UpdateSiteToolBody,
  type UploadToolHtmlBody,
  type ConfigureToolDraftBody,
  type SetToolAvailabilityBody,
  CreateSiteToolBodySchema,
  UpdateSiteToolBodySchema,
  UploadToolHtmlBodySchema,
  ConfigureToolDraftBodySchema,
  SetToolAvailabilityBodySchema,
  ToolVersionBodySchema,
  listSiteToolsRoute,
  getSiteToolRoute,
  createSiteToolRoute,
  updateSiteToolRoute,
  uploadSiteToolHtmlRoute,
  configureSiteToolDraftRoute,
  checkSiteToolRoute,
  publishSiteToolRoute,
  deleteSiteToolRoute,
  discardSiteToolDraftRoute,
  setSiteToolAvailabilityRoute,
} from "@kanvas/contracts/api";
import {
  InstanceAccessStoreError,
  SiteToolStoreError,
  type SiteToolCommand,
  type SiteToolMutation,
} from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { inspectHtmlTool } from "../tools/html-tool-inspection.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";

export function mapSiteToolError(error: unknown): never {
  if (
    error instanceof InstanceAccessStoreError &&
    error.code === "instance_access.forbidden"
  )
    throw new ForbiddenException(
      "Only an active site administrator may maintain tools.",
    );
  if (error instanceof ToolImageError)
    throw new BadRequestException({ code: error.code, detail: error.message });
  if (error instanceof SiteToolStoreError) {
    const detail = { code: `site_tool.${error.code}`, detail: error.message };
    if (error.code === "invalid") throw new BadRequestException(detail);
    if (error.code === "not_found") throw new NotFoundException(detail);
    throw new ConflictException(detail);
  }
  throw error;
}

@Controller()
@UseGuards(InstanceAdministratorGuard)
export class SiteToolsController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: InstanceAdministratorContextStore,
    private readonly covers?: SiteCoverService,
  ) {}

  @ContractRoute(uploadSiteToolImageRoute)
  @RouteConfig({ siteToolUpload: true })
  public async uploadImage(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(UploadToolImageBodySchema))
    body: UploadToolImageBody,
  ) {
    if (!key) throw new BadRequestException("Idempotency-Key is required.");
    const bytes = Buffer.from(body.contentBase64, "base64");
    if (bytes.toString("base64") !== body.contentBase64)
      throw new BadRequestException(
        "Image content must use canonical Base64 encoding.",
      );
    try {
      const normalized = await normalizeToolImage(bytes);
      return await this.database.siteToolImages.upload(
        this.contexts.require(request).scope,
        key,
        normalized,
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(getSiteToolImageRoute)
  @Header("Cache-Control", "no-store")
  public async image(
    @Req() request: FastifyRequest,
    @Param("imageId") imageId: string,
  ) {
    try {
      const image = await this.database.siteToolImages.readForAdministrator(
        this.contexts.require(request).scope,
        imageId,
      );
      return toolImageContent(
        this.covers ? await this.covers.materialize(image) : image,
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(listToolIntegrationsRoute)
  @Header("Cache-Control", "no-store")
  public async integrations(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(ToolIntegrationQuerySchema))
    query: ToolIntegrationQuery,
    @Headers("accept-language") language: string | undefined,
  ) {
    try {
      return await this.database.siteTools.integrations(
        this.contexts.require(request).scope,
        query,
        language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN",
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(listSiteToolsRoute)
  @Header("Cache-Control", "no-store")
  public async list(@Req() request: FastifyRequest) {
    try {
      return {
        items: await this.database.siteTools.list(
          this.contexts.require(request).scope,
        ),
      };
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(getSiteToolRoute)
  @Header("Cache-Control", "no-store")
  public async detail(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
  ) {
    try {
      return await this.database.siteTools.detail(
        this.contexts.require(request).scope,
        toolId,
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(getSiteToolSourceRoute)
  @Header("Cache-Control", "no-store")
  public async source(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Query(new ContractBodyPipe(ToolSourceQuerySchema)) query: ToolSourceQuery,
  ) {
    try {
      return await this.database.siteTools.source(
        this.contexts.require(request).scope,
        toolId,
        query.revisionId,
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  private async execute(
    request: FastifyRequest,
    key: string | undefined,
    command: SiteToolCommand,
  ): Promise<SiteToolMutation> {
    if (!key) throw new BadRequestException("Idempotency-Key is required.");
    try {
      return await this.database.siteTools.mutate(
        this.contexts.require(request).scope,
        key,
        command,
        inspectHtmlTool,
      );
    } catch (error) {
      return mapSiteToolError(error);
    }
  }

  @ContractRoute(createSiteToolRoute)
  public create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(CreateSiteToolBodySchema))
    body: CreateSiteToolBody,
  ) {
    return this.execute(request, key, { kind: "create", presentation: body });
  }

  @ContractRoute(updateSiteToolRoute)
  public update(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(UpdateSiteToolBodySchema))
    body: UpdateSiteToolBody,
  ) {
    const { expectedVersion, ...presentation } = body;
    return this.execute(request, key, {
      kind: "update",
      toolId,
      expectedVersion,
      presentation,
    });
  }

  @ContractRoute(uploadSiteToolHtmlRoute)
  @RouteConfig({ siteToolUpload: true })
  public upload(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(UploadToolHtmlBodySchema))
    body: UploadToolHtmlBody,
  ) {
    const bytes = Buffer.from(body.contentBase64, "base64");
    if (bytes.toString("base64") !== body.contentBase64)
      throw new BadRequestException(
        "HTML content must use canonical Base64 encoding.",
      );
    return this.execute(request, key, {
      kind: "upload",
      toolId,
      expectedVersion: body.expectedVersion,
      filename: body.filename,
      bytes,
    });
  }

  @ContractRoute(configureSiteToolDraftRoute)
  public configure(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(ConfigureToolDraftBodySchema))
    body: ConfigureToolDraftBody,
  ) {
    return this.execute(request, key, {
      kind: "configure",
      toolId,
      expectedVersion: body.expectedVersion,
      config: body,
    });
  }

  @ContractRoute(checkSiteToolRoute)
  public check(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(ToolVersionBodySchema))
    body: { expectedVersion: number },
  ) {
    return this.execute(request, key, {
      kind: "check",
      toolId,
      expectedVersion: body.expectedVersion,
    });
  }

  @ContractRoute(publishSiteToolRoute)
  public publish(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(ToolVersionBodySchema))
    body: { expectedVersion: number },
  ) {
    return this.execute(request, key, {
      kind: "publish",
      toolId,
      expectedVersion: body.expectedVersion,
    });
  }

  @ContractRoute(discardSiteToolDraftRoute)
  public discardDraft(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(ToolVersionBodySchema))
    body: { expectedVersion: number },
  ) {
    return this.execute(request, key, {
      kind: "discard",
      toolId,
      expectedVersion: body.expectedVersion,
    });
  }

  @ContractRoute(deleteSiteToolRoute)
  public deleteTool(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(ToolVersionBodySchema))
    body: { expectedVersion: number },
  ) {
    return this.execute(request, key, {
      kind: "delete",
      toolId,
      expectedVersion: body.expectedVersion,
    });
  }

  @ContractRoute(setSiteToolAvailabilityRoute)
  public availability(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(SetToolAvailabilityBodySchema))
    body: SetToolAvailabilityBody,
  ) {
    return this.execute(request, key, {
      kind: "availability",
      toolId,
      ...body,
    });
  }
}
