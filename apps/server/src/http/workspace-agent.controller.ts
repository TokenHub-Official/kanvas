import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  AgentRunPathSchema,
  CompleteAgentCanvasExportBodySchema,
  completeAgentCanvasExportRoute,
  type CompleteAgentCanvasExportBody,
  AgentThreadListQuerySchema,
  AgentThreadPathSchema,
  ArchiveAgentThreadBodySchema,
  CancelAgentRunBodySchema,
  AgentActionPathSchema,
  AgentInteractionPathSchema,
  ResolveAgentInteractionBodySchema,
  ConfirmAgentActionBodySchema,
  DeclineAgentActionBodySchema,
  CreateWorkspaceAgentMessageBodySchema,
  RenameAgentThreadBodySchema,
  RegenerateAgentResponseBodySchema,
  SelectAgentResponseBranchBodySchema,
  archiveWorkspaceAgentThreadRoute,
  cancelAgentRunRoute,
  createWorkspaceAgentMessageRoute,
  confirmAgentActionRoute,
  declineAgentActionRoute,
  resolveAgentInteractionRoute,
  getAgentRunRoute,
  getAgentRunDiagnosticsRoute,
  getWorkspaceAgentThreadRoute,
  streamWorkspaceAgentThreadRoute,
  listWorkspaceAgentThreadsRoute,
  renameWorkspaceAgentThreadRoute,
  regenerateWorkspaceAgentResponseRoute,
  selectWorkspaceAgentResponseBranchRoute,
  type AgentThreadList,
  type AgentThreadListQuery,
  type AgentThreadView,
  type AgentThreadSummary,
  type AgentRunAccepted,
  type AgentRunView,
  type AgentRunDiagnostics,
  type CancelAgentRunBody,
  type CancelledAgentRun,
  type ConfirmAgentActionBody,
  type ConfirmedAgentAction,
  type DeclineAgentActionBody,
  type DeclinedAgentAction,
  type ResolveAgentInteractionBody,
  type ResolvedAgentInteraction,
  type CreateWorkspaceAgentMessageBody,
  type ArchiveAgentThreadBody,
  type RenameAgentThreadBody,
  type RegenerateAgentResponseBody,
  type SelectAgentResponseBranchBody,
} from "@kanvas/contracts/api";
import type { FastifyReply, FastifyRequest } from "fastify";

import { WorkspaceAgentService } from "../agent/workspace-agent.service.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const agentThreadStreamIntervalMs = 250;

function agentDisplayLocale(
  acceptLanguage: string | undefined,
): "zh-CN" | "en-US" {
  return acceptLanguage?.toLocaleLowerCase().startsWith("en")
    ? "en-US"
    : "zh-CN";
}

function decodeAgentThreadCursor(cursor: string): {
  readonly updatedAt: Date;
  readonly id: string;
} {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Cursor payload must be an object.");
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof record.updatedAt !== "string" ||
      typeof record.id !== "string" ||
      !idPattern.test(record.id)
    ) {
      throw new TypeError("Cursor fields are invalid.");
    }
    const updatedAt = new Date(record.updatedAt);
    if (!Number.isFinite(updatedAt.getTime())) {
      throw new TypeError("Cursor timestamp is invalid.");
    }
    return { updatedAt, id: record.id };
  } catch {
    throw new BadRequestException("Agent thread cursor is invalid.");
  }
}

function encodeAgentThreadCursor(cursor: {
  readonly updatedAt: Date;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: cursor.updatedAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

@Controller()
export class WorkspaceAgentController {
  public constructor(
    private readonly agent: WorkspaceAgentService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(completeAgentCanvasExportRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public completeCanvasExport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentActionPathSchema))
    params: { readonly actionReceiptId: string },
    @Body(new ContractBodyPipe(CompleteAgentCanvasExportBodySchema))
    body: CompleteAgentCanvasExportBody,
  ): Promise<{ accepted: true }> {
    return this.agent.completeCanvasExport({
      authority: this.contexts.require(request).scope,
      actionReceiptId: params.actionReceiptId,
      body,
      now: new Date(),
    });
  }

  @ContractRoute(createWorkspaceAgentMessageRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateWorkspaceAgentMessageBodySchema))
    body: CreateWorkspaceAgentMessageBody,
  ): Promise<AgentRunAccepted> {
    return this.agent.create({
      authority: this.contexts.require(request).scope,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(resolveAgentInteractionRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public resolveInteraction(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(AgentInteractionPathSchema))
    params: { readonly interactionId: string },
    @Body(new ContractBodyPipe(ResolveAgentInteractionBodySchema))
    body: ResolveAgentInteractionBody,
  ): Promise<ResolvedAgentInteraction> {
    return this.agent.resolveInteraction({
      authority: this.contexts.require(request).scope,
      interactionId: params.interactionId,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(listWorkspaceAgentThreadsRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listThreads(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(AgentThreadListQuerySchema))
    query: AgentThreadListQuery,
  ): Promise<AgentThreadList> {
    const result = await this.agent.listThreads({
      authority: this.contexts.require(request).scope,
      ...(query.cursor
        ? { cursor: decodeAgentThreadCursor(query.cursor) }
        : {}),
      limit: Number(query.limit ?? "30"),
      now: new Date(),
    });
    return {
      items: result.items,
      ...(result.nextCursor
        ? { nextCursor: encodeAgentThreadCursor(result.nextCursor) }
        : {}),
    };
  }

  @ContractRoute(getWorkspaceAgentThreadRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getThread(
    @Req() request: FastifyRequest,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
  ): Promise<AgentThreadView> {
    return this.agent.getThread({
      authority: this.contexts.require(request).scope,
      threadId: params.threadId,
      locale: agentDisplayLocale(acceptLanguage),
      now: new Date(),
    });
  }

  @ContractRoute(streamWorkspaceAgentThreadRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async streamThread(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
  ): Promise<void> {
    const authority = this.contexts.require(request).scope;
    const locale = agentDisplayLocale(acceptLanguage);
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    let closed = false;
    let reading = false;
    let lastPayload = "";
    const intervalRef: { current?: ReturnType<typeof setInterval> } = {};
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      reply.raw.end();
    };
    const push = async (): Promise<void> => {
      if (closed || reading) return;
      reading = true;
      try {
        const view = await this.agent.getThread({
          authority,
          threadId: params.threadId,
          locale,
          now: new Date(),
        });
        const payload = JSON.stringify(view);
        if (payload !== lastPayload) {
          lastPayload = payload;
          reply.raw.write(`event: thread\ndata: ${payload}\n\n`);
        }
        const status = view.latestRun?.lifecycleStatus;
        if (status && !["queued", "running"].includes(status)) {
          close();
        }
      } catch {
        if (!closed) reply.raw.write("event: error\ndata: {}\n\n");
        close();
      } finally {
        reading = false;
      }
    };
    // ponytail: poll-backed SSE is bounded to one active Run; replace with
    // pub/sub only when concurrent Agent traffic makes this measurable.
    intervalRef.current = setInterval(
      () => void push(),
      agentThreadStreamIntervalMs,
    );
    request.raw.once("close", close);
    await push();
  }

  @ContractRoute(regenerateWorkspaceAgentResponseRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public regenerate(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
    @Body(new ContractBodyPipe(RegenerateAgentResponseBodySchema))
    body: RegenerateAgentResponseBody,
  ): Promise<AgentRunAccepted> {
    return this.agent.regenerate({
      authority: this.contexts.require(request).scope,
      threadId: params.threadId,
      body,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(selectWorkspaceAgentResponseBranchRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public selectBranch(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
    @Body(new ContractBodyPipe(SelectAgentResponseBranchBodySchema))
    body: SelectAgentResponseBranchBody,
  ): Promise<AgentThreadSummary> {
    return this.agent.selectBranch({
      authority: this.contexts.require(request).scope,
      threadId: params.threadId,
      body,
      now: new Date(),
    });
  }

  @ContractRoute(renameWorkspaceAgentThreadRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public renameThread(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
    @Body(new ContractBodyPipe(RenameAgentThreadBodySchema))
    body: RenameAgentThreadBody,
  ): Promise<AgentThreadSummary> {
    return this.agent.renameThread({
      authority: this.contexts.require(request).scope,
      threadId: params.threadId,
      expectedVersion: body.expectedVersion,
      title: body.title,
      now: new Date(),
    });
  }

  @ContractRoute(archiveWorkspaceAgentThreadRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public archiveThread(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentThreadPathSchema))
    params: { readonly workspaceId: string; readonly threadId: string },
    @Body(new ContractBodyPipe(ArchiveAgentThreadBodySchema))
    body: ArchiveAgentThreadBody,
  ): Promise<AgentThreadSummary> {
    return this.agent.archiveThread({
      authority: this.contexts.require(request).scope,
      threadId: params.threadId,
      expectedVersion: body.expectedVersion,
      now: new Date(),
    });
  }

  @ContractRoute(getAgentRunRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getRun(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentRunPathSchema))
    params: { readonly agentRunId: string },
  ): Promise<AgentRunView> {
    return this.agent.get({
      authority: this.contexts.require(request).scope,
      agentRunId: params.agentRunId,
      now: new Date(),
    });
  }

  @ContractRoute(getAgentRunDiagnosticsRoute)
  @RequireWorkspacePermission("audit.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public getDiagnostics(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentRunPathSchema))
    params: { readonly agentRunId: string },
  ): Promise<AgentRunDiagnostics> {
    return this.agent.getDiagnostics({
      authority: this.contexts.require(request).scope,
      agentRunId: params.agentRunId,
      now: new Date(),
    });
  }

  @ContractRoute(cancelAgentRunRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public cancelRun(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(AgentRunPathSchema))
    params: { readonly agentRunId: string },
    @Body(new ContractBodyPipe(CancelAgentRunBodySchema))
    body: CancelAgentRunBody,
  ): Promise<CancelledAgentRun> {
    void body;
    return this.agent.cancelRun({
      authority: this.contexts.require(request).scope,
      agentRunId: params.agentRunId,
      now: new Date(),
    });
  }

  @ContractRoute(confirmAgentActionRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public confirm(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(AgentActionPathSchema))
    params: { readonly actionReceiptId: string },
    @Body(new ContractBodyPipe(ConfirmAgentActionBodySchema))
    body: ConfirmAgentActionBody,
  ): Promise<ConfirmedAgentAction> {
    void body;
    return this.agent.confirm({
      authority: this.contexts.require(request).scope,
      actionReceiptId: params.actionReceiptId,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }

  @ContractRoute(declineAgentActionRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public decline(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(AgentActionPathSchema))
    params: { readonly actionReceiptId: string },
    @Body(new ContractBodyPipe(DeclineAgentActionBodySchema))
    body: DeclineAgentActionBody,
  ): Promise<DeclinedAgentAction> {
    void body;
    return this.agent.decline({
      authority: this.contexts.require(request).scope,
      actionReceiptId: params.actionReceiptId,
      idempotencyKey: idempotencyKey ?? "",
      now: new Date(),
    });
  }
}
