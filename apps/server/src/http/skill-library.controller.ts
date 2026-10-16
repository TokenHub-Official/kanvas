import type { SkillArchiveFilenameEncoding } from "@kanvas/database/runtime";
import { RouteConfig } from "@nestjs/platform-fastify";
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Query,
  PayloadTooLargeException,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  ArchiveSkillDraftBodySchema,
  ChangeSkillRuntimeStatusBodySchema,
  CreateSkillDraftBodySchema,
  PublishSkillCandidateBodySchema,
  RecordSkillCandidateTestBodySchema,
  SkillCandidatePathSchema,
  SkillDefinitionPathSchema,
  SkillDraftPathSchema,
  SkillRevisionPathSchema,
  SubmitSkillCandidateBodySchema,
  UpdateSkillDraftBodySchema,
  archiveSkillDraftRoute,
  changeSkillRuntimeStatusRoute,
  createSkillDraftRoute,
  exportSkillPackageRoute,
  getSkillFileRoute,
  getSkillDraftFileRoute,
  SkillFileQuerySchema,
  SkillDraftFileQuerySchema,
  type SkillFileQuery,
  type SkillDraftFileQuery,
  getSkillDraftRoute,
  getAgentHubSkillRoute,
  importSkillPackageRoute,
  listSkillDraftsRoute,
  publishSkillCandidateRoute,
  recordSkillCandidateTestRoute,
  submitSkillCandidateRoute,
  updateSkillDraftRoute,
  type AgentHubSkill,
  type AgentHubSkillDetail,
  type ArchiveSkillDraftBody,
  type ChangeSkillRuntimeStatusBody,
  type CreateSkillDraftBody,
  type PublishSkillCandidateBody,
  type RecordSkillCandidateTestBody,
  type SkillDraftList,
  type SkillDraftDetail,
  type SkillDraftSummary,
  type SkillRuntimeStatus,
  type SubmitSkillCandidateBody,
  type UpdateSkillDraftBody,
} from "@kanvas/contracts/api";
import type { FastifyReply, FastifyRequest } from "fastify";

import { SkillLibraryService } from "../skills/skill-library.service.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { isSkillPackageUploadContentType } from "./raw-upload-content-parser.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function requireByteStream(body: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof (body as { readonly [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] !== "function"
  ) {
    throw new BadRequestException(
      "Skill package body must be a binary stream.",
    );
  }
  return body as AsyncIterable<Uint8Array>;
}

async function collectPackage(
  body: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > 64 * 1024 * 1024) {
      throw new PayloadTooLargeException("Skill package exceeds 64 MiB.");
    }
    chunks.push(chunk);
  }
  if (total < 1) throw new BadRequestException("Skill package is empty.");
  return Buffer.concat(chunks);
}

@Controller()
export class SkillLibraryController {
  public constructor(
    private readonly skills: SkillLibraryService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listSkillDraftsRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public listDrafts(@Req() request: FastifyRequest): Promise<SkillDraftList> {
    return this.skills.listDrafts(
      this.contexts.require(request).scope,
      new Date(),
    );
  }

  @ContractRoute(getAgentHubSkillRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getPublishedSkill(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillDefinitionPathSchema))
    path: { readonly skillDefinitionId: string },
  ): Promise<AgentHubSkillDetail> {
    return this.skills.getPublishedSkill({
      authority: this.contexts.require(request).scope,
      skillDefinitionId: path.skillDefinitionId,
      now: new Date(),
    });
  }

  @ContractRoute(getSkillDraftRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getDraft(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillDraftPathSchema))
    path: { readonly skillDraftId: string },
  ): Promise<SkillDraftDetail> {
    return this.skills.getDraft({
      authority: this.contexts.require(request).scope,
      draftId: path.skillDraftId,
      now: new Date(),
    });
  }

  @RouteConfig({ bodyLimit: 16 * 1024 * 1024 })
  @ContractRoute(createSkillDraftRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public createDraft(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateSkillDraftBodySchema))
    body: CreateSkillDraftBody,
  ): Promise<SkillDraftSummary> {
    return this.skills.createDraft({
      authority: this.contexts.require(request).scope,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(importSkillPackageRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async importPackage(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Headers("x-skill-filename-encoding") filenameEncoding: string | undefined,
    @Body() body: unknown,
  ): Promise<SkillDraftSummary> {
    if (!isSkillPackageUploadContentType(contentType)) {
      throw new UnsupportedMediaTypeException(
        "Upload a .zip or .skill package.",
      );
    }
    if (
      filenameEncoding &&
      !["auto", "utf-8", "gb18030", "big5", "shift_jis", "cp437"].includes(
        filenameEncoding,
      )
    ) {
      throw new BadRequestException("Unsupported ZIP filename encoding.");
    }
    return this.skills.importPackage({
      filenameEncoding: (filenameEncoding ??
        "auto") as SkillArchiveFilenameEncoding,
      authority: this.contexts.require(request).scope,
      idempotencyKey: idempotencyKey ?? "",
      bytes: await collectPackage(requireByteStream(body)),
      now: new Date(),
    });
  }

  @RouteConfig({ bodyLimit: 16 * 1024 * 1024 })
  @ContractRoute(updateSkillDraftRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public updateDraft(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillDraftPathSchema))
    path: { readonly skillDraftId: string },
    @Body(new ContractBodyPipe(UpdateSkillDraftBodySchema))
    body: UpdateSkillDraftBody,
  ): Promise<SkillDraftSummary> {
    return this.skills.updateDraft({
      authority: this.contexts.require(request).scope,
      draftId: path.skillDraftId,
      body,
      now: new Date(),
    });
  }

  @ContractRoute(archiveSkillDraftRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async archiveDraft(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillDraftPathSchema))
    path: { readonly skillDraftId: string },
    @Body(new ContractBodyPipe(ArchiveSkillDraftBodySchema))
    body: ArchiveSkillDraftBody,
  ): Promise<null> {
    await this.skills.archiveDraft({
      authority: this.contexts.require(request).scope,
      draftId: path.skillDraftId,
      expectedVersion: body.expectedDraftVersion,
      now: new Date(),
    });
    return null;
  }

  @ContractRoute(submitSkillCandidateRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public submitCandidate(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillDraftPathSchema))
    path: { readonly skillDraftId: string },
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(SubmitSkillCandidateBodySchema))
    body: SubmitSkillCandidateBody,
  ): Promise<SkillDraftSummary> {
    return this.skills.submitCandidate({
      authority: this.contexts.require(request).scope,
      draftId: path.skillDraftId,
      expectedDraftVersion: body.expectedDraftVersion,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(publishSkillCandidateRoute)
  @RequireWorkspacePermission("skill.publish")
  @UseGuards(WorkspaceAuthorizationGuard)
  public publishCandidate(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillCandidatePathSchema))
    path: { readonly skillCandidateId: string },
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(PublishSkillCandidateBodySchema))
    body: PublishSkillCandidateBody,
  ): Promise<AgentHubSkill> {
    return this.skills.publishCandidate({
      authority: this.contexts.require(request).scope,
      candidateId: path.skillCandidateId,
      expectedCandidateDigest: body.expectedCandidateDigest,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(recordSkillCandidateTestRoute)
  @RequireWorkspacePermission("skill.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public recordCandidateTest(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillCandidatePathSchema))
    path: { readonly skillCandidateId: string },
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(RecordSkillCandidateTestBodySchema))
    body: RecordSkillCandidateTestBody,
  ): Promise<SkillDraftSummary> {
    return this.skills.recordCandidateTest({
      authority: this.contexts.require(request).scope,
      candidateId: path.skillCandidateId,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(changeSkillRuntimeStatusRoute)
  @RequireWorkspacePermission("skill.publish")
  @UseGuards(WorkspaceAuthorizationGuard)
  public changeRuntimeStatus(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(SkillRevisionPathSchema))
    path: { readonly skillRevisionId: string },
    @Body(new ContractBodyPipe(ChangeSkillRuntimeStatusBodySchema))
    body: ChangeSkillRuntimeStatusBody,
  ): Promise<SkillRuntimeStatus> {
    return this.skills.changeRuntimeStatus({
      authority: this.contexts.require(request).scope,
      skillRevisionId: path.skillRevisionId,
      body,
      now: new Date(),
    });
  }

  @ContractRoute(getSkillFileRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async readPublishedFile(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(SkillDefinitionPathSchema))
    path: { skillDefinitionId: string },
    @Query(new ContractBodyPipe(SkillFileQuerySchema)) query: SkillFileQuery,
  ): Promise<void> {
    const file = await this.skills.readFile({
      authority: this.contexts.require(request).scope,
      skillDefinitionId: path.skillDefinitionId,
      ...(query.skillRevisionId
        ? { skillRevisionId: query.skillRevisionId }
        : {}),
      path: query.path,
      now: new Date(),
    });
    this.sendFile(reply, file);
  }

  @ContractRoute(getSkillDraftFileRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async readDraftFile(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(SkillDraftPathSchema))
    path: { skillDraftId: string },
    @Query(new ContractBodyPipe(SkillDraftFileQuerySchema))
    query: SkillDraftFileQuery,
  ): Promise<void> {
    const file = await this.skills.readFile({
      authority: this.contexts.require(request).scope,
      draftId: path.skillDraftId,
      draftVersion: Number(query.draftVersion),
      path: query.path,
      now: new Date(),
    });
    this.sendFile(reply, file);
  }

  private sendFile(
    reply: FastifyReply,
    file: { bytes: Buffer; mediaType: string; filename: string },
  ): void {
    reply.headers({
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "content-type": file.mediaType,
      "content-length": String(file.bytes.length),
      "x-content-type-options": "nosniff",
    });
    reply.send(file.bytes);
  }

  @ContractRoute(exportSkillPackageRoute)
  @RequireWorkspacePermission("skill.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async exportPackage(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(SkillDefinitionPathSchema))
    path: { readonly skillDefinitionId: string },
  ): Promise<void> {
    const exported = await this.skills.exportPackage({
      authority: this.contexts.require(request).scope,
      skillDefinitionId: path.skillDefinitionId,
      now: new Date(),
    });
    reply.headers({
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${exported.filename}"`,
      "content-length": String(exported.bytes.byteLength),
      "content-type": "application/zip",
      "x-content-type-options": "nosniff",
    });
    reply.send(exported.bytes);
  }
}
