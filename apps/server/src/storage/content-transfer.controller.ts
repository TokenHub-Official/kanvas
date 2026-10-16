import { Readable } from "node:stream";

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  PayloadTooLargeException,
  ServiceUnavailableException,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  allocateCanvasExportRoute,
  AllocateCanvasExportBodySchema,
  allocateUserImportRoute,
  AllocateUserImportBodySchema,
  ArtifactContentPathSchema,
  CanvasExportUploadSessionPathSchema,
  commitCanvasExportRoute,
  CommitCanvasExportBodySchema,
  commitUserImportRoute,
  CommitUserImportBodySchema,
  downloadArtifactContentRoute,
  getArtifactPreviewRoute,
  getCanvasExportRoute,
  uploadCanvasExportRoute,
  uploadUserImportRoute,
  UserImportUploadSessionPathSchema,
  type AllocateCanvasExportBody,
  type AllocateUserImportBody,
  type CanvasExportIngestion,
  type CanvasExportUploadSession,
  type CommitCanvasExportBody,
  type CommitUserImportBody,
  type CommittedCanvasExport,
  type CommittedUserImport,
  type UserImportIngestion,
  type UserImportUploadSession,
} from "@kanvas/contracts/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import sharp from "sharp";

import { ContractBodyPipe } from "../http/contract-body.pipe.js";
import { ContractRoute } from "../http/contract-route.decorator.js";
import { isTrustedImageUploadContentType } from "../http/raw-upload-content-parser.js";
import { RequestAuthorizationContextStore } from "../http/request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "../http/workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "../http/workspace-permission.decorator.js";
import { ContentTransferService } from "./content-transfer.service.js";

function requireByteStream(body: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof (
      body as {
        readonly [Symbol.asyncIterator]?: unknown;
      }
    )[Symbol.asyncIterator] !== "function"
  ) {
    throw new BadRequestException(
      "The import content body must be a binary stream.",
    );
  }
  return body as AsyncIterable<Uint8Array>;
}

async function collectPreviewInput(
  body: AsyncIterable<Uint8Array>,
  maximumBytes = 40 * 1_024 * 1_024,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maximumBytes) {
      throw new PayloadTooLargeException(
        "Artifact is too large to prepare an interactive preview.",
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

@Controller()
export class ContentTransferController {
  public constructor(
    private readonly transfers: ContentTransferService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(allocateCanvasExportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async allocateCanvasExport(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(AllocateCanvasExportBodySchema))
    body: AllocateCanvasExportBody,
  ): Promise<CanvasExportUploadSession> {
    const { scope } = this.contexts.require(request);
    return this.transfers.allocateCanvasExport(
      scope,
      idempotencyKey ?? "",
      body,
    );
  }

  @ContractRoute(getCanvasExportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async getCanvasExport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasExportUploadSessionPathSchema))
    params: { readonly exportSessionId: string },
  ): Promise<CanvasExportUploadSession> {
    const { scope } = this.contexts.require(request);
    return this.transfers.getCanvasExport(scope, params.exportSessionId);
  }

  @ContractRoute(uploadCanvasExportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async uploadCanvasExport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasExportUploadSessionPathSchema))
    params: { readonly exportSessionId: string },
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<CanvasExportIngestion> {
    if (!isTrustedImageUploadContentType(contentType)) {
      throw new UnsupportedMediaTypeException(
        "Canvas Export content type is not supported.",
      );
    }
    const { scope } = this.contexts.require(request);
    return this.transfers.uploadCanvasExport(
      scope,
      params.exportSessionId,
      requireByteStream(body),
    );
  }

  @ContractRoute(commitCanvasExportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async commitCanvasExport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasExportUploadSessionPathSchema))
    params: { readonly exportSessionId: string },
    @Body(new ContractBodyPipe(CommitCanvasExportBodySchema))
    body: CommitCanvasExportBody,
  ): Promise<CommittedCanvasExport> {
    const { scope } = this.contexts.require(request);
    return this.transfers.commitCanvasExport(
      scope,
      params.exportSessionId,
      body,
      request.id,
    );
  }

  @ContractRoute(allocateUserImportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async allocate(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(AllocateUserImportBodySchema))
    body: AllocateUserImportBody,
  ): Promise<UserImportUploadSession> {
    const { scope } = this.contexts.require(request);
    return this.transfers.allocateUserImport(scope, idempotencyKey ?? "", body);
  }

  @ContractRoute(uploadUserImportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async upload(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(UserImportUploadSessionPathSchema))
    params: { readonly uploadSessionId: string },
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<UserImportIngestion> {
    if (!isTrustedImageUploadContentType(contentType)) {
      throw new UnsupportedMediaTypeException(
        "Import content type is not supported.",
      );
    }
    const { scope } = this.contexts.require(request);
    return this.transfers.uploadUserImport(
      scope,
      params.uploadSessionId,
      requireByteStream(body),
    );
  }

  @ContractRoute(commitUserImportRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async commit(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(UserImportUploadSessionPathSchema))
    params: { readonly uploadSessionId: string },
    @Body(new ContractBodyPipe(CommitUserImportBodySchema))
    body: CommitUserImportBody,
  ): Promise<CommittedUserImport> {
    const { scope } = this.contexts.require(request);
    return this.transfers.commitUserImport(
      scope,
      params.uploadSessionId,
      body,
      request.id,
    );
  }

  @ContractRoute(downloadArtifactContentRoute)
  @RequireWorkspacePermission("artifact.download")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async download(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(ArtifactContentPathSchema))
    params: { readonly artifactId: string },
    @Headers("range") rangeHeader: string | undefined,
  ): Promise<void> {
    const { scope } = this.contexts.require(request);
    const prepared = await this.transfers.prepareArtifactDownload(
      scope,
      params.artifactId,
      rangeHeader,
      request.id,
    );
    reply.headers(prepared.headers);
    reply.status(prepared.status);
    reply.send(Readable.from(prepared.body));
  }

  @ContractRoute(getArtifactPreviewRoute)
  @RequireWorkspacePermission("artifact.download")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async preview(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(ArtifactContentPathSchema))
    params: { readonly artifactId: string },
  ): Promise<void> {
    const { scope } = this.contexts.require(request);
    const persisted = await this.transfers.preparePersistedArtifactPreview(
      scope,
      params.artifactId,
      request.id,
    );
    if (persisted) {
      reply.headers(persisted.headers);
      reply.status(200);
      reply.send(Readable.from(persisted.body));
      return;
    }
    const previewConfig = this.transfers.artifactPreviewConfig();
    if (
      previewConfig.mode === "async_persisted" &&
      !previewConfig.fallbackOnMiss
    ) {
      throw new ServiceUnavailableException(
        "Persisted Artifact preview is not ready.",
      );
    }
    const prepared = await this.transfers.prepareArtifactDownload(
      scope,
      params.artifactId,
      undefined,
      request.id,
    );
    const input = await collectPreviewInput(
      prepared.body,
      previewConfig.maximumSourceBytes,
    );
    let preview: Buffer;
    try {
      preview = await sharp(input, {
        animated: false,
        limitInputPixels: 100_000_000,
      })
        .rotate()
        .resize({
          width: previewConfig.width,
          height: previewConfig.height,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          quality: previewConfig.quality,
          effort: previewConfig.effort,
        })
        .toBuffer();
    } catch {
      throw new UnsupportedMediaTypeException(
        "Artifact content cannot be rendered as an image preview.",
      );
    }
    reply.headers({
      "cache-control": "private, max-age=86400, must-revalidate",
      "content-length": String(preview.byteLength),
      "content-type": "image/webp",
    });
    reply.status(200);
    reply.send(preview);
  }
}
