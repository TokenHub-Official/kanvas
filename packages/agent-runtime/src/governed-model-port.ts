import type {
  AgentModelCallPurpose,
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";

import type {
  KanvasAgentModelPort,
  KanvasAgentModelRequest,
  KanvasAgentModelReportedCharge,
  KanvasAgentModelResponse,
} from "./kanvas-model.js";

export interface GovernedAgentModelRoute<TRoute> {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly value: TRoute;
}

export interface AgentModelRouteResolver<TRoute> {
  readonly resolve: (options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentRunId: string;
    readonly modelProfileKey: string;
    readonly request: KanvasAgentModelRequest;
    readonly now: Date;
  }) => Promise<GovernedAgentModelRoute<TRoute>>;
}

export interface AgentModelTransport<TRoute> {
  readonly generate: (options: {
    readonly route: TRoute;
    readonly request: KanvasAgentModelRequest;
    readonly signal: AbortSignal | undefined;
  }) => Promise<KanvasAgentModelResponse>;
  readonly stream: (options: {
    readonly route: TRoute;
    readonly request: KanvasAgentModelRequest;
    readonly signal: AbortSignal | undefined;
  }) => PromiseLike<LanguageModelV3StreamResult>;
  readonly reportedCharge?: (options: {
    readonly route: TRoute;
    readonly rawUsage: unknown;
  }) => KanvasAgentModelReportedCharge | undefined;
}

export interface AgentModelBudgetPort<TRoute, TReservation> {
  readonly reserve: (options: {
    readonly route: TRoute;
    readonly request: KanvasAgentModelRequest;
    readonly agentRunId: string;
    readonly modelCallId: string;
    readonly now: Date;
  }) => Promise<TReservation>;
  readonly capture: (options: {
    readonly reservation: TReservation;
    readonly route: TRoute;
    readonly response: KanvasAgentModelResponse;
    readonly modelCallId: string;
    readonly now: Date;
  }) => Promise<void>;
  readonly fail: (options: {
    readonly reservation: TReservation;
    readonly route: TRoute;
    readonly failure: AgentModelFailureClassification;
    readonly modelCallId: string;
    readonly now: Date;
  }) => Promise<void>;
}

export interface AgentModelRuntimeIdentityFactory {
  readonly modelCallId: (callNumber: number) => string;
  readonly modelAttemptId: (
    callNumber: number,
    attemptNumber: number,
  ) => string;
}

export interface AgentModelFailureClassification {
  readonly status: "cancelled" | "failed" | "unknown";
  readonly stableReasonCode: string;
  readonly retryableBeforeProviderRequest?: boolean;
}

export interface AgentModelPreparationCoordinator {
  readonly run: <TResult>(
    operation: () => Promise<TResult>,
  ) => Promise<TResult>;
}

export function createAgentModelPreparationCoordinator(): AgentModelPreparationCoordinator {
  let tail = Promise.resolve();
  return Object.freeze({
    async run<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  });
}

export interface CreateGovernedAgentModelPortOptions<TRoute, TReservation> {
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly modelProfileKey: string;
  readonly purpose: AgentModelCallPurpose;
  readonly facts: AgentRuntimeRepository;
  readonly routes: AgentModelRouteResolver<TRoute>;
  readonly transport: AgentModelTransport<TRoute>;
  readonly budget: AgentModelBudgetPort<TRoute, TReservation>;
  readonly identities: AgentModelRuntimeIdentityFactory;
  readonly preparation?: AgentModelPreparationCoordinator;
  readonly nextCallNumber?: () => number;
  readonly digest: (value: unknown) => string;
  readonly classifyFailure: (error: unknown) => AgentModelFailureClassification;
  readonly now?: () => Date;
  readonly onStreamPart?: (
    part: LanguageModelV3StreamPart,
    identity: {
      readonly modelCallId: string;
      readonly attemptId: string;
      readonly callNumber: number;
    },
  ) => void;
  readonly onObservation?: (observation: AgentModelCallObservation) => void;
}

export interface AgentModelCallObservation {
  readonly event: "request_started" | "first_output" | "succeeded" | "failed";
  readonly observedAt: Date;
  readonly agentRunId: string;
  readonly modelCallId: string;
  readonly callNumber: number;
  readonly purpose: AgentModelCallPurpose;
  readonly modelProfileKey: string;
  readonly preparationDurationMs?: number;
  readonly durationMs?: number;
  readonly totalDurationMs?: number;
  readonly finishReason?: string;
  readonly providerRequestId?: string;
  readonly resolvedModelId?: string;
  readonly usage?: KanvasAgentModelResponse["usage"];
  readonly failure?: AgentModelFailureClassification;
  readonly error?: unknown;
}

export class GovernedAgentModelError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "GovernedAgentModelError";
  }
}

function usageDocument(
  response: KanvasAgentModelResponse,
): Readonly<Record<string, unknown>> | undefined {
  const usage = response.usage;
  if (!usage && !response.reportedCharge) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    ...(usage?.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage?.inputTokensNoCache === undefined
      ? {}
      : { inputTokensNoCache: usage.inputTokensNoCache }),
    ...(usage?.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage?.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage?.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage?.outputTextTokens === undefined
      ? {}
      : { outputTextTokens: usage.outputTextTokens }),
    ...(usage?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
    ...(response.reportedCharge === undefined
      ? {}
      : {
          reportedCharge: Object.freeze({
            currencyCode: response.reportedCharge.currencyCode,
            amount: response.reportedCharge.amount,
          }),
        }),
  });
}

function responseDigestDocument(
  response: KanvasAgentModelResponse,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    content: Object.freeze(
      response.content.map((part) => Object.freeze({ ...part })),
    ),
    finishReason: response.finishReason,
    ...(response.rawFinishReason === undefined
      ? {}
      : { rawFinishReason: response.rawFinishReason }),
    ...(response.usage === undefined ? {} : { usage: usageDocument(response) }),
    ...(response.responseId === undefined
      ? {}
      : { responseId: response.responseId }),
    ...(response.resolvedModelId === undefined
      ? {}
      : { resolvedModelId: response.resolvedModelId }),
    ...(response.startedAt === undefined
      ? {}
      : { startedAt: response.startedAt.toISOString() }),
    ...(response.sources === undefined
      ? {}
      : {
          sources: Object.freeze(
            response.sources.map((source) =>
              Object.freeze({
                url: source.url,
                ...(source.title === undefined ? {} : { title: source.title }),
              }),
            ),
          ),
        }),
  });
}

export function agentModelRequestDigestDocument(
  request: KanvasAgentModelRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...request,
    prompt: Object.freeze(
      request.prompt.map((message) =>
        message.role === "system"
          ? message
          : Object.freeze({
              ...message,
              content: Object.freeze(
                message.content.map((part) => {
                  if (part.type !== "file") return part;
                  let data: Readonly<Record<string, unknown>> | string;
                  if (part.data instanceof URL) {
                    data = Object.freeze({
                      kind: "url",
                      origin: part.data.origin,
                      pathname: part.data.pathname,
                    });
                  } else if (part.data instanceof Uint8Array) {
                    data = Object.freeze({
                      kind: "bytes",
                      byteLength: part.data.byteLength,
                    });
                  } else {
                    data = "inline-image";
                  }
                  return Object.freeze({ ...part, data });
                }),
              ),
            }),
      ),
    ),
  });
}

function streamResponseAccumulator() {
  const content: Array<
    | {
        type: "text" | "reasoning";
        text: string;
        providerMetadata?: SharedV3ProviderMetadata;
      }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: string;
        providerMetadata?: SharedV3ProviderMetadata;
      }
  > = [];
  const byId = new Map<string, number>();
  const sources = new Map<
    string,
    { readonly url: string; readonly title?: string }
  >();
  let finish:
    Extract<LanguageModelV3StreamPart, { type: "finish" }> | undefined;
  let responseId: string | undefined;
  let resolvedModelId: string | undefined;
  let startedAt: Date | undefined;
  const textPart = (
    type: "text" | "reasoning",
    id: string,
    providerMetadata?: SharedV3ProviderMetadata,
  ) => {
    const key = `${type}:${id}`;
    const existing = byId.get(key);
    if (existing !== undefined) {
      const part = content[existing];
      if (part && (part.type === "text" || part.type === "reasoning")) {
        if (providerMetadata) part.providerMetadata = providerMetadata;
        return part;
      }
    }
    const part = {
      type,
      text: "",
      ...(providerMetadata ? { providerMetadata } : {}),
    };
    byId.set(key, content.length);
    content.push(part);
    return part;
  };
  return Object.freeze({
    consume(part: LanguageModelV3StreamPart): void {
      switch (part.type) {
        case "text-start":
        case "text-end":
          textPart("text", part.id, part.providerMetadata);
          break;
        case "text-delta":
          textPart("text", part.id, part.providerMetadata).text += part.delta;
          break;
        case "reasoning-start":
        case "reasoning-end":
          textPart("reasoning", part.id, part.providerMetadata);
          break;
        case "reasoning-delta":
          textPart("reasoning", part.id, part.providerMetadata).text +=
            part.delta;
          break;
        case "tool-call":
          if (part.providerExecuted || part.toolName.trim().length === 0) {
            break;
          }
          content.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input:
              typeof part.input === "string"
                ? part.input
                : JSON.stringify(part.input),
            ...(part.providerMetadata
              ? { providerMetadata: part.providerMetadata }
              : {}),
          });
          break;
        case "source":
          if (part.sourceType === "url" && part.url.startsWith("https://")) {
            sources.set(part.url, {
              url: part.url,
              ...(part.title ? { title: part.title } : {}),
            });
          }
          break;
        case "response-metadata":
          responseId = part.id ?? responseId;
          resolvedModelId = part.modelId ?? resolvedModelId;
          startedAt = part.timestamp ?? startedAt;
          break;
        case "finish":
          finish = part;
          break;
      }
    },
    rawUsage(): unknown {
      return finish?.usage.raw;
    },
    response(
      reportedCharge?: KanvasAgentModelReportedCharge,
    ): KanvasAgentModelResponse {
      if (!finish) {
        throw new Error("Agent Model stream ended without a finish part.");
      }
      return Object.freeze({
        content: Object.freeze(
          content.filter(
            (part) => part.type === "tool-call" || part.text.length > 0,
          ),
        ),
        finishReason: finish.finishReason.unified,
        ...(finish.finishReason.raw
          ? { rawFinishReason: finish.finishReason.raw }
          : {}),
        usage: {
          ...(finish.usage.inputTokens.total === undefined
            ? {}
            : { inputTokens: finish.usage.inputTokens.total }),
          ...(finish.usage.inputTokens.noCache === undefined
            ? {}
            : { inputTokensNoCache: finish.usage.inputTokens.noCache }),
          ...(finish.usage.inputTokens.cacheRead === undefined
            ? {}
            : { cacheReadTokens: finish.usage.inputTokens.cacheRead }),
          ...(finish.usage.inputTokens.cacheWrite === undefined
            ? {}
            : { cacheWriteTokens: finish.usage.inputTokens.cacheWrite }),
          ...(finish.usage.outputTokens.total === undefined
            ? {}
            : { outputTokens: finish.usage.outputTokens.total }),
          ...(finish.usage.outputTokens.text === undefined
            ? {}
            : { outputTextTokens: finish.usage.outputTokens.text }),
          ...(finish.usage.outputTokens.reasoning === undefined
            ? {}
            : { reasoningTokens: finish.usage.outputTokens.reasoning }),
        },
        ...(reportedCharge ? { reportedCharge } : {}),
        ...(responseId ? { responseId } : {}),
        ...(resolvedModelId ? { resolvedModelId } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(sources.size > 0
          ? { sources: Object.freeze([...sources.values()].slice(0, 20)) }
          : {}),
      });
    },
  });
}

export function createGovernedAgentModelPort<TRoute, TReservation>(
  options: CreateGovernedAgentModelPortOptions<TRoute, TReservation>,
): KanvasAgentModelPort {
  let callNumber = 0;
  const now = options.now ?? (() => new Date());
  const observe = (observation: AgentModelCallObservation): void => {
    try {
      options.onObservation?.(Object.freeze(observation));
    } catch {
      // Diagnostics must never alter the governed model-call outcome.
    }
  };

  const prepareCallUncoordinated = async (request: KanvasAgentModelRequest) => {
    callNumber += 1;
    const currentCallNumber = options.nextCallNumber?.() ?? callNumber;
    const modelCallId = options.identities.modelCallId(currentCallNumber);
    const attemptId = options.identities.modelAttemptId(currentCallNumber, 1);
    const callStartedAt = now();
    const observationBase = Object.freeze({
      agentRunId: options.agentRunId,
      modelCallId,
      callNumber: currentCallNumber,
      purpose: options.purpose,
      modelProfileKey: options.modelProfileKey,
    });
    await options.facts.beginModelCall({
      ...(options.workerClaim ? { workerClaim: options.workerClaim } : {}),
      authority: options.authority,
      agentRunId: options.agentRunId,
      modelCallId,
      callNumber: currentCallNumber,
      purpose: options.purpose,
      modelProfileKey: options.modelProfileKey,
      inputDigest: options.digest(agentModelRequestDigestDocument(request)),
      now: now(),
    });

    let route: GovernedAgentModelRoute<TRoute>;
    let routeResolutionAttempt = 0;
    while (true) {
      routeResolutionAttempt += 1;
      try {
        route = await options.routes.resolve({
          authority: options.authority,
          agentRunId: options.agentRunId,
          modelProfileKey: options.modelProfileKey,
          request,
          now: now(),
        });
        break;
      } catch (error) {
        const failure = options.classifyFailure(error);
        if (
          failure.status === "failed" &&
          failure.retryableBeforeProviderRequest === true &&
          routeResolutionAttempt < 2
        ) {
          continue;
        }
        const failedAt = now();
        observe({
          event: "failed",
          observedAt: failedAt,
          ...observationBase,
          totalDurationMs: failedAt.getTime() - callStartedAt.getTime(),
          failure,
          error,
        });
        await options.facts.startModelAttempt({
          ...(options.workerClaim ? { workerClaim: options.workerClaim } : {}),
          authority: options.authority,
          agentRunId: options.agentRunId,
          modelCallId,
          attemptId,
          attemptNumber: 1,
          transitionKind: "initial",
          routeSnapshot: Object.freeze({
            schemaVersion: 1,
            resolution: "failed",
            modelProfileKey: options.modelProfileKey,
            routeResolutionAttempts: routeResolutionAttempt,
          }),
          now: now(),
        });
        await options.facts.completeModelAttempt({
          authority: options.authority,
          agentRunId: options.agentRunId,
          modelCallId,
          attemptId,
          status: failure.status,
          terminalReasonCode: failure.stableReasonCode,
          terminalForCall: true,
          now: now(),
        });
        throw new GovernedAgentModelError(failure.stableReasonCode);
      }
    }

    await options.facts.startModelAttempt({
      ...(options.workerClaim ? { workerClaim: options.workerClaim } : {}),
      authority: options.authority,
      agentRunId: options.agentRunId,
      modelCallId,
      attemptId,
      attemptNumber: 1,
      transitionKind: "initial",
      routeSnapshot: route.snapshot,
      now: now(),
    });

    let reservation: TReservation;
    try {
      reservation = await options.budget.reserve({
        route: route.value,
        request,
        agentRunId: options.agentRunId,
        modelCallId,
        now: now(),
      });
    } catch (error) {
      const failure = options.classifyFailure(error);
      const failedAt = now();
      observe({
        event: "failed",
        observedAt: failedAt,
        ...observationBase,
        totalDurationMs: failedAt.getTime() - callStartedAt.getTime(),
        failure,
        error,
      });
      await options.facts.completeModelAttempt({
        authority: options.authority,
        agentRunId: options.agentRunId,
        modelCallId,
        attemptId,
        status: failure.status,
        terminalReasonCode: failure.stableReasonCode,
        terminalForCall: true,
        now: now(),
      });
      throw new GovernedAgentModelError(failure.stableReasonCode);
    }
    const requestStartedAt = now();
    observe({
      event: "request_started",
      observedAt: requestStartedAt,
      ...observationBase,
      preparationDurationMs:
        requestStartedAt.getTime() - callStartedAt.getTime(),
    });
    return {
      route,
      reservation,
      modelCallId,
      attemptId,
      callNumber: currentCallNumber,
      callStartedAt,
      requestStartedAt,
    };
  };
  const prepareCall = (request: KanvasAgentModelRequest) =>
    options.preparation
      ? options.preparation.run(() => prepareCallUncoordinated(request))
      : prepareCallUncoordinated(request);

  const failCall = async (
    prepared: Awaited<ReturnType<typeof prepareCall>>,
    error: unknown,
  ): Promise<never> => {
    const failure = options.classifyFailure(error);
    const failedAt = now();
    observe({
      event: "failed",
      observedAt: failedAt,
      agentRunId: options.agentRunId,
      modelCallId: prepared.modelCallId,
      callNumber: prepared.callNumber,
      purpose: options.purpose,
      modelProfileKey: options.modelProfileKey,
      durationMs: failedAt.getTime() - prepared.requestStartedAt.getTime(),
      totalDurationMs: failedAt.getTime() - prepared.callStartedAt.getTime(),
      failure,
      error,
    });
    await options.facts.completeModelAttempt({
      authority: options.authority,
      agentRunId: options.agentRunId,
      modelCallId: prepared.modelCallId,
      attemptId: prepared.attemptId,
      status: failure.status,
      terminalReasonCode: failure.stableReasonCode,
      terminalForCall: true,
      now: now(),
    });
    try {
      await options.budget.fail({
        reservation: prepared.reservation,
        route: prepared.route.value,
        failure,
        modelCallId: prepared.modelCallId,
        now: now(),
      });
    } catch {
      // The durable terminal attempt lets the budget reconciler retry.
    }
    throw new GovernedAgentModelError(failure.stableReasonCode);
  };

  const completeCall = async (
    prepared: Awaited<ReturnType<typeof prepareCall>>,
    response: KanvasAgentModelResponse,
  ): Promise<KanvasAgentModelResponse> => {
    const measuredUsage = usageDocument(response);
    await options.facts.completeModelAttempt({
      authority: options.authority,
      agentRunId: options.agentRunId,
      modelCallId: prepared.modelCallId,
      attemptId: prepared.attemptId,
      status: "succeeded",
      outputDigest: options.digest(responseDigestDocument(response)),
      finishReason: response.finishReason,
      ...(response.responseId
        ? { providerRequestId: response.responseId }
        : {}),
      ...(measuredUsage ? { usageDocument: measuredUsage } : {}),
      now: now(),
    });
    try {
      await options.budget.capture({
        reservation: prepared.reservation,
        route: prepared.route.value,
        response,
        modelCallId: prepared.modelCallId,
        now: now(),
      });
    } catch {
      // The successful attempt already contains every available settlement fact.
    }
    const completedAt = now();
    observe({
      event: "succeeded",
      observedAt: completedAt,
      agentRunId: options.agentRunId,
      modelCallId: prepared.modelCallId,
      callNumber: prepared.callNumber,
      purpose: options.purpose,
      modelProfileKey: options.modelProfileKey,
      durationMs: completedAt.getTime() - prepared.requestStartedAt.getTime(),
      totalDurationMs: completedAt.getTime() - prepared.callStartedAt.getTime(),
      finishReason: response.finishReason,
      ...(response.responseId
        ? { providerRequestId: response.responseId }
        : {}),
      ...(response.resolvedModelId
        ? { resolvedModelId: response.resolvedModelId }
        : {}),
      ...(response.usage ? { usage: response.usage } : {}),
    });
    return response;
  };

  return Object.freeze({
    async generate(
      request: KanvasAgentModelRequest,
      signal: AbortSignal | undefined,
    ): Promise<KanvasAgentModelResponse> {
      const prepared = await prepareCall(request);
      let response: KanvasAgentModelResponse;
      try {
        response = await options.transport.generate({
          route: prepared.route.value,
          request,
          signal,
        });
      } catch (error) {
        return failCall(prepared, error);
      }
      return completeCall(prepared, response);
    },

    async stream(
      request: KanvasAgentModelRequest,
      signal: AbortSignal | undefined,
    ): Promise<LanguageModelV3StreamResult> {
      const prepared = await prepareCall(request);
      let result: LanguageModelV3StreamResult;
      try {
        result = await options.transport.stream({
          route: prepared.route.value,
          request,
          signal,
        });
      } catch (error) {
        return failCall(prepared, error);
      }
      const accumulator = streamResponseAccumulator();
      const reader = result.stream.getReader();
      const ignoredProviderToolIds = new Set<string>();
      let firstOutputObserved = false;
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          void (async () => {
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                if (next.value.type === "error") {
                  throw next.value.error;
                }
                if (
                  next.value.type === "tool-input-start" &&
                  (next.value.providerExecuted ||
                    next.value.toolName.trim().length === 0)
                ) {
                  ignoredProviderToolIds.add(next.value.id);
                  continue;
                }
                if (
                  (next.value.type === "tool-input-delta" ||
                    next.value.type === "tool-input-end") &&
                  ignoredProviderToolIds.has(next.value.id)
                ) {
                  continue;
                }
                if (
                  next.value.type === "tool-call" &&
                  (next.value.providerExecuted ||
                    next.value.toolName.trim().length === 0)
                ) {
                  ignoredProviderToolIds.add(next.value.toolCallId);
                  continue;
                }
                if (
                  next.value.type === "tool-result" &&
                  (next.value.toolName.trim().length === 0 ||
                    ignoredProviderToolIds.has(next.value.toolCallId))
                ) {
                  continue;
                }
                accumulator.consume(next.value);
                options.onStreamPart?.(next.value, {
                  modelCallId: prepared.modelCallId,
                  attemptId: prepared.attemptId,
                  callNumber: prepared.callNumber,
                });
                if (
                  !firstOutputObserved &&
                  ((next.value.type === "text-delta" &&
                    next.value.delta.length > 0) ||
                    (next.value.type === "reasoning-delta" &&
                      next.value.delta.length > 0) ||
                    next.value.type === "tool-call" ||
                    next.value.type === "source")
                ) {
                  firstOutputObserved = true;
                  const observedAt = now();
                  observe({
                    event: "first_output",
                    observedAt,
                    agentRunId: options.agentRunId,
                    modelCallId: prepared.modelCallId,
                    callNumber: prepared.callNumber,
                    purpose: options.purpose,
                    modelProfileKey: options.modelProfileKey,
                    durationMs:
                      observedAt.getTime() -
                      prepared.requestStartedAt.getTime(),
                    totalDurationMs:
                      observedAt.getTime() - prepared.callStartedAt.getTime(),
                  });
                }
                controller.enqueue(next.value);
              }
            } catch (error) {
              try {
                await failCall(prepared, error);
              } catch (failure) {
                controller.error(failure);
              }
              return;
            }
            try {
              const reportedCharge = options.transport.reportedCharge?.({
                route: prepared.route.value,
                rawUsage: accumulator.rawUsage(),
              });
              await completeCall(
                prepared,
                accumulator.response(reportedCharge),
              );
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          })();
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return { ...result, stream };
    },
  });
}
