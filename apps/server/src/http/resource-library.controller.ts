import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  getLibraryRoute,
  getLibraryTextRoute,
  listLibrariesRoute,
  saveLibraryRoute,
  setLibraryLifecycleRoute,
  uploadLibraryFileRoute,
  SaveLibraryBodySchema,
  LibraryLifecycleBodySchema,
  LibraryListQuerySchema,
  LibraryUploadQuerySchema,
  type SaveLibraryBody,
  type LibraryLifecycleBody,
  type LibraryListQuery,
  type LibraryUploadQuery,
} from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import {
  libraryAudit,
  ResourceLibraryService,
} from "../resource-libraries/resource-library.service.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

@Controller()
@UseGuards(WorkspaceAuthorizationGuard)
export class ResourceLibraryController {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly files: ResourceLibraryService,
  ) {}

  @ContractRoute(listLibrariesRoute)
  @RequireWorkspacePermission("library.read")
  async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(LibraryListQuerySchema))
    query: LibraryListQuery,
  ) {
    const { scope } = this.contexts.require(request);
    const items = await this.database.resourceLibraries.list({
      authority: scope,
      lifecycleStatus: query.lifecycleStatus ?? "active",
      ...(query.query !== undefined ? { query: query.query } : {}),
      ...(query.afterId !== undefined ? { afterId: query.afterId } : {}),
      limit: 51,
      now: new Date(),
    });
    const page = items.slice(0, 50);
    return {
      items: page.map((item) => ({
        ...item,
        updatedAt: item.updatedAt.toISOString(),
      })),
      ...(items.length > 50 ? { nextCursor: page.at(-1)!.id } : {}),
    };
  }

  @ContractRoute(getLibraryRoute)
  @RequireWorkspacePermission("library.read")
  async get(
    @Req() request: FastifyRequest,
    @Param("libraryId") libraryId: string,
  ) {
    const { scope } = this.contexts.require(request);
    const library = await this.database.resourceLibraries.getSummary({
      authority: scope,
      libraryId,
      now: new Date(),
    });
    const revision = await this.database.resourceLibraries.getRevision({
      authority: scope,
      libraryId,
      revisionId: library.currentRevisionId,
      now: new Date(),
    });
    return {
      library: { ...library, updatedAt: library.updatedAt.toISOString() },
      revision: { ...revision, createdAt: revision.createdAt.toISOString() },
    };
  }

  @ContractRoute(saveLibraryRoute)
  @RequireWorkspacePermission("library.manage")
  async save(
    @Req() request: FastifyRequest,
    @Param("libraryId") libraryId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(SaveLibraryBodySchema)) body: SaveLibraryBody,
  ) {
    const { scope } = this.contexts.require(request);
    const result = await this.database.resourceLibraries.save({
      authority: scope,
      libraryId,
      ...body,
      revisionId: ulid(),
      requestKey: key ?? "",
      audit: libraryAudit(scope, request.id),
      now: new Date(),
    });
    return {
      ...result,
      revision: {
        ...result.revision,
        createdAt: result.revision.createdAt.toISOString(),
      },
    };
  }

  @ContractRoute(setLibraryLifecycleRoute)
  @RequireWorkspacePermission("library.manage")
  async lifecycle(
    @Req() request: FastifyRequest,
    @Param("libraryId") libraryId: string,
    @Body(new ContractBodyPipe(LibraryLifecycleBodySchema))
    body: LibraryLifecycleBody,
  ) {
    const { scope } = this.contexts.require(request);
    await this.database.resourceLibraries.setLifecycle({
      authority: scope,
      libraryId,
      ...body,
      audit: libraryAudit(scope, request.id),
      now: new Date(),
    });
    return { updated: true as const };
  }

  @ContractRoute(getLibraryTextRoute)
  @RequireWorkspacePermission("library.read")
  text(
    @Req() request: FastifyRequest,
    @Param("libraryId") libraryId: string,
    @Param("artifactId") artifactId: string,
  ) {
    return this.files.text(
      this.contexts.require(request).scope,
      libraryId,
      artifactId,
    );
  }

  @ContractRoute(uploadLibraryFileRoute)
  @RequireWorkspacePermission("library.manage")
  upload(
    @Req() request: FastifyRequest,
    @Param("libraryId") libraryId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Query(new ContractBodyPipe(LibraryUploadQuerySchema))
    query: LibraryUploadQuery,
    @Body() body: unknown,
  ) {
    return this.files.upload(
      this.contexts.require(request).scope,
      libraryId,
      key ?? "",
      query,
      body,
      request.id,
    );
  }
}
