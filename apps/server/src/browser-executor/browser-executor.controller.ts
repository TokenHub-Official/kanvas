import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { Readable } from "node:stream";
import {
  acknowledgeBrowserAttemptCancellationRoute,
  AcknowledgeBrowserAttemptCancellationBodySchema,
  allocateBrowserAttemptOutputRoute,
  AllocateBrowserAttemptOutputBodySchema,
  BrowserAssignmentPathSchema,
  BrowserAttemptOutputAllocationHeadersSchema,
  BrowserAttemptOutputUploadHeadersSchema,
  BrowserAttemptOutputUploadSessionPathSchema,
  BrowserExecutorSessionPathSchema,
  claimBrowserAttemptRoute,
  ClaimBrowserAttemptBodySchema,
  CompleteBrowserAttemptBodySchema,
  completeBrowserAttemptRoute,
  drainBrowserExecutorRoute,
  downloadBrowserModelResourceRoute,
  getBrowserRuntimeManifestRoute,
  HeartbeatBrowserAttemptBodySchema,
  heartbeatBrowserAttemptRoute,
  ModelResourceRevisionPathSchema,
  RegisterBrowserExecutorBodySchema,
  registerBrowserExecutorRoute,
  revokeBrowserExecutorRoute,
  uploadBrowserAttemptOutputRoute,
  type BrowserAttemptHeartbeatResponse,
  type BrowserAttemptCompletionResponse,
  type AcknowledgeBrowserAttemptCancellationBody,
  type AllocateBrowserAttemptOutputBody,
  type BrowserAttemptCancellationAcknowledgement,
  type BrowserAttemptOutputIngestion,
  type BrowserAttemptOutputUploadSession,
  type BrowserExecutorSessionTransition,
  type BrowserRuntimeManifest,
  type ClaimBrowserAttemptBody,
  type ClaimBrowserAttemptResponse,
  type CompleteBrowserAttemptBody,
  type HeartbeatBrowserAttemptBody,
  type RegisteredBrowserExecutor,
  type RegisterBrowserExecutorBody,
} from "@kanvas/contracts/api";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ContractBodyPipe } from "../http/contract-body.pipe.js";
import { ContractRoute } from "../http/contract-route.decorator.js";
import { isBrowserOutputContentType } from "../http/raw-upload-content-parser.js";
import { RequestAuthorizationContextStore } from "../http/request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "../http/workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "../http/workspace-permission.decorator.js";
import { BrowserExecutorControlPlaneService } from "./browser-executor-control-plane.service.js";

interface BrowserOutputAllocationHeaders {
  readonly "x-kanvas-workspace-id": string;
  readonly "x-kanvas-attempt-grant": string;
  readonly "idempotency-key": string;
}

interface BrowserOutputUploadHeaders {
  readonly "x-kanvas-workspace-id": string;
  readonly "x-kanvas-attempt-grant": string;
  readonly "x-kanvas-attempt-id": string;
  readonly "x-kanvas-attempt-lease-generation": string;
  readonly "x-kanvas-execution-generation": string;
  readonly "x-kanvas-output-role": string;
  readonly "x-kanvas-output-index": string;
}

const outputAllocationHeadersPipe = new ContractBodyPipe(
  BrowserAttemptOutputAllocationHeadersSchema,
);
const outputUploadHeadersPipe = new ContractBodyPipe(
  BrowserAttemptOutputUploadHeadersSchema,
);

function boundedUint32Header(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 4_294_967_295) {
    throw new BadRequestException(`${label} is invalid.`);
  }
  return parsed;
}

function positiveUint32Header(value: string, label: string): number {
  const parsed = boundedUint32Header(value, label);
  if (parsed === 0) {
    throw new BadRequestException(`${label} is invalid.`);
  }
  return parsed;
}

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
      "The output content body must be a binary stream.",
    );
  }
  return body as AsyncIterable<Uint8Array>;
}

@Controller()
export class BrowserExecutorController {
  public constructor(
    private readonly controlPlane: BrowserExecutorControlPlaneService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(getBrowserRuntimeManifestRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async manifest(
    @Req() request: FastifyRequest,
  ): Promise<BrowserRuntimeManifest> {
    const { scope } = this.contexts.require(request);
    return this.controlPlane.runtimeManifest(scope);
  }

  @ContractRoute(downloadBrowserModelResourceRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async modelResource(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ContractBodyPipe(ModelResourceRevisionPathSchema))
    params: { readonly modelResourceRevisionId: string },
  ): Promise<void> {
    const { scope } = this.contexts.require(request);
    const prepared = await this.controlPlane.openModelResource(
      scope,
      params.modelResourceRevisionId,
    );
    reply.headers(prepared.headers);
    reply.status(200);
    reply.send(Readable.from(prepared.body));
  }

  @ContractRoute(registerBrowserExecutorRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async register(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(RegisterBrowserExecutorBodySchema))
    body: RegisterBrowserExecutorBody,
  ): Promise<RegisteredBrowserExecutor> {
    const { scope } = this.contexts.require(request);
    return this.controlPlane.register(scope, body);
  }

  @ContractRoute(claimBrowserAttemptRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async claim(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrowserExecutorSessionPathSchema))
    params: { readonly browserExecutorSessionId: string },
    @Body(new ContractBodyPipe(ClaimBrowserAttemptBodySchema))
    body: ClaimBrowserAttemptBody,
  ): Promise<ClaimBrowserAttemptResponse> {
    const { scope } = this.contexts.require(request);
    return this.controlPlane.claim(
      scope,
      params.browserExecutorSessionId,
      body.controlPlaneVersion,
    );
  }

  @ContractRoute(heartbeatBrowserAttemptRoute)
  public async heartbeat(
    @Headers("x-kanvas-workspace-id") workspaceId: string | undefined,
    @Headers("x-kanvas-attempt-grant") attemptGrant: string | undefined,
    @Param(new ContractBodyPipe(BrowserAssignmentPathSchema))
    params: {
      readonly browserExecutorSessionId: string;
      readonly browserAssignmentId: string;
    },
    @Body(new ContractBodyPipe(HeartbeatBrowserAttemptBodySchema))
    body: HeartbeatBrowserAttemptBody,
  ): Promise<BrowserAttemptHeartbeatResponse> {
    return this.controlPlane.heartbeat(
      workspaceId ?? "",
      params.browserExecutorSessionId,
      params.browserAssignmentId,
      attemptGrant ?? "",
      body,
    );
  }

  @ContractRoute(allocateBrowserAttemptOutputRoute)
  public async allocateOutput(
    @Headers() rawHeaders: FastifyRequest["headers"],
    @Param(new ContractBodyPipe(BrowserAssignmentPathSchema))
    params: {
      readonly browserExecutorSessionId: string;
      readonly browserAssignmentId: string;
    },
    @Body(new ContractBodyPipe(AllocateBrowserAttemptOutputBodySchema))
    body: AllocateBrowserAttemptOutputBody,
  ): Promise<BrowserAttemptOutputUploadSession> {
    const headers = outputAllocationHeadersPipe.transform(
      rawHeaders,
    ) as BrowserOutputAllocationHeaders;
    return this.controlPlane.allocateAttemptOutput(
      headers["x-kanvas-workspace-id"],
      params.browserExecutorSessionId,
      params.browserAssignmentId,
      headers["x-kanvas-attempt-grant"],
      headers["idempotency-key"],
      body,
    );
  }

  @ContractRoute(uploadBrowserAttemptOutputRoute)
  public async uploadOutput(
    @Headers() rawHeaders: FastifyRequest["headers"],
    @Param(new ContractBodyPipe(BrowserAttemptOutputUploadSessionPathSchema))
    params: {
      readonly browserExecutorSessionId: string;
      readonly browserAssignmentId: string;
      readonly uploadSessionId: string;
    },
    @Body() body: unknown,
  ): Promise<BrowserAttemptOutputIngestion> {
    if (!isBrowserOutputContentType(rawHeaders["content-type"])) {
      throw new UnsupportedMediaTypeException(
        "Output content type is not supported.",
      );
    }
    const headers = outputUploadHeadersPipe.transform(
      rawHeaders,
    ) as BrowserOutputUploadHeaders;
    return this.controlPlane.uploadAttemptOutput(
      headers["x-kanvas-workspace-id"],
      params.browserExecutorSessionId,
      params.browserAssignmentId,
      params.uploadSessionId,
      headers["x-kanvas-attempt-grant"],
      headers["x-kanvas-attempt-id"],
      positiveUint32Header(
        headers["x-kanvas-attempt-lease-generation"],
        "x-kanvas-attempt-lease-generation",
      ),
      positiveUint32Header(
        headers["x-kanvas-execution-generation"],
        "x-kanvas-execution-generation",
      ),
      headers["x-kanvas-output-role"],
      boundedUint32Header(
        headers["x-kanvas-output-index"],
        "x-kanvas-output-index",
      ),
      requireByteStream(body),
    );
  }

  @ContractRoute(completeBrowserAttemptRoute)
  public async complete(
    @Headers("x-kanvas-workspace-id") workspaceId: string | undefined,
    @Headers("x-kanvas-attempt-grant") attemptGrant: string | undefined,
    @Param(new ContractBodyPipe(BrowserAssignmentPathSchema))
    params: {
      readonly browserExecutorSessionId: string;
      readonly browserAssignmentId: string;
    },
    @Body(new ContractBodyPipe(CompleteBrowserAttemptBodySchema))
    body: CompleteBrowserAttemptBody,
  ): Promise<BrowserAttemptCompletionResponse> {
    return this.controlPlane.complete(
      workspaceId ?? "",
      params.browserExecutorSessionId,
      params.browserAssignmentId,
      attemptGrant ?? "",
      body,
    );
  }

  @ContractRoute(acknowledgeBrowserAttemptCancellationRoute)
  public async acknowledgeCancellation(
    @Headers("x-kanvas-workspace-id") workspaceId: string | undefined,
    @Headers("x-kanvas-attempt-grant") attemptGrant: string | undefined,
    @Param(new ContractBodyPipe(BrowserAssignmentPathSchema))
    params: {
      readonly browserExecutorSessionId: string;
      readonly browserAssignmentId: string;
    },
    @Body(new ContractBodyPipe(AcknowledgeBrowserAttemptCancellationBodySchema))
    body: AcknowledgeBrowserAttemptCancellationBody,
  ): Promise<BrowserAttemptCancellationAcknowledgement> {
    return this.controlPlane.acknowledgeCancellation(
      workspaceId ?? "",
      params.browserExecutorSessionId,
      params.browserAssignmentId,
      attemptGrant ?? "",
      body,
    );
  }

  @ContractRoute(drainBrowserExecutorRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async drain(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrowserExecutorSessionPathSchema))
    params: { readonly browserExecutorSessionId: string },
  ): Promise<BrowserExecutorSessionTransition> {
    const { scope } = this.contexts.require(request);
    return this.controlPlane.drain(scope, params.browserExecutorSessionId);
  }

  @ContractRoute(revokeBrowserExecutorRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async revoke(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrowserExecutorSessionPathSchema))
    params: { readonly browserExecutorSessionId: string },
  ): Promise<BrowserExecutorSessionTransition> {
    const { scope } = this.contexts.require(request);
    return this.controlPlane.revoke(scope, params.browserExecutorSessionId);
  }
}
