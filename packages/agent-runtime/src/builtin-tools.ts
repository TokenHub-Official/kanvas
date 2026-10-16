import { createTool, type Tool } from "@mastra/core/tools";
import type {
  AgentQuestionAnswerV1,
  AgentQuestionItemV1,
  AgentQuestionOptionV1,
  AgentQuestionRequestV1,
  AgentQuestionResponseV1,
} from "@kanvas/application";
import type { JSONSchema7 } from "json-schema";

export type {
  AgentQuestionAnswerV1,
  AgentQuestionItemV1,
  AgentQuestionOptionV1,
  AgentQuestionRequestV1,
  AgentQuestionResponseV1,
} from "@kanvas/application";

export const askQuestionToolKey = "builtin.ask-question";
export const askQuestionToolName = "ask_question";
export const agentBuiltinToolViewRevision = "kanvas.platform-builtin-tools/v1";

export type AgentBuiltinToolLifecycle = "immediate" | "wait_for_user";

export interface AgentBuiltinToolDefinition {
  readonly key: string;
  readonly modelName: string;
  readonly revision: number;
  readonly lifecycle: AgentBuiltinToolLifecycle;
  readonly description: string;
  readonly inputSchema: JSONSchema7;
  readonly outputSchema: JSONSchema7;
  readonly usageInstructions: readonly string[];
}

export interface AgentBuiltinQuestionSuspension {
  readonly toolCallId: string;
  readonly request: AgentQuestionRequestV1;
  readonly checkpoint: AgentRunContinuationCheckpointV1;
}

export interface AgentAnsweredQuestionFact {
  readonly questionKey: string;
  readonly question: string;
  readonly selectedOptionKeys: readonly string[];
  readonly customText?: string;
}

export interface AgentRunContinuationCheckpointV1 {
  readonly schemaVersion: 1;
  readonly adapter: "mastra-message-list-v2";
  readonly toolCallId: string;
  readonly toolName: "ask_question";
  readonly toolCallCount: number;
  readonly continuationMessages: readonly unknown[];
}

export interface AgentBuiltinToolSession {
  readonly tools: Readonly<Record<string, Tool>>;
  suspension(options: {
    readonly finishReason: string | undefined;
    readonly suspendPayload: unknown;
    readonly messages: readonly unknown[];
    readonly toolCalls: readonly unknown[];
    readonly steps: readonly unknown[];
    readonly inputMessageIds: readonly string[];
    readonly previousToolCallCount: number;
  }): AgentBuiltinQuestionSuspension | undefined;
}

export interface CreateAgentBuiltinToolSessionOptions {
  readonly answeredQuestions?: readonly AgentAnsweredQuestionFact[];
}

const keyPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
const maximumCheckpointCharacters = 1_000_000;
const maximumToolCallIdCharacters = 256;
const maximumControlCharacterCode = 31;
const deleteCharacterCode = 127;

function validToolCallId(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= maximumToolCallIdCharacters &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        code <= maximumControlCharacterCode || code === deleteCharacterCode
      );
    })
  );
}

const questionInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "header", "question", "options"],
        properties: {
          key: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[a-z][a-z0-9_-]{0,63}$",
          },
          header: { type: "string", minLength: 1, maxLength: 32 },
          question: { type: "string", minLength: 1, maxLength: 400 },
          multiSelect: { type: "boolean" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "label"],
              properties: {
                key: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  pattern: "^[a-z][a-z0-9_-]{0,63}$",
                },
                label: { type: "string", minLength: 1, maxLength: 80 },
                description: { type: "string", minLength: 1, maxLength: 240 },
                recommended: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies JSONSchema7;

const questionOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "outcome"],
  properties: {
    schemaVersion: { const: 1 },
    outcome: { enum: ["submitted", "skipped"] },
    answers: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionKey", "optionKeys"],
        properties: {
          questionKey: { type: "string", maxLength: 64 },
          optionKeys: {
            type: "array",
            maxItems: 4,
            items: { type: "string", maxLength: 64 },
          },
          customText: { type: "string", maxLength: 1_000 },
        },
      },
    },
    supplement: { type: "string", maxLength: 1_000 },
  },
} as const satisfies JSONSchema7;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : undefined;
}

function parseOption(value: unknown): AgentQuestionOptionV1 | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const allowed = new Set(["key", "label", "description", "recommended"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return undefined;
  const key = text(candidate.key, 1, 64);
  const label = text(candidate.label, 1, 80);
  const description =
    candidate.description === undefined
      ? undefined
      : text(candidate.description, 1, 240);
  if (
    !key ||
    !keyPattern.test(key) ||
    !label ||
    (candidate.description !== undefined && !description) ||
    (candidate.recommended !== undefined &&
      typeof candidate.recommended !== "boolean")
  ) {
    return undefined;
  }
  return Object.freeze({
    key,
    label,
    ...(description ? { description } : {}),
    ...(candidate.recommended === true ? { recommended: true } : {}),
  });
}

function parseQuestion(value: unknown): AgentQuestionItemV1 | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const allowed = new Set([
    "key",
    "header",
    "question",
    "multiSelect",
    "options",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return undefined;
  const key = text(candidate.key, 1, 64);
  const header = text(candidate.header, 1, 32);
  const question = text(candidate.question, 1, 400);
  const options = Array.isArray(candidate.options)
    ? candidate.options.map(parseOption)
    : [];
  if (
    !key ||
    !keyPattern.test(key) ||
    !header ||
    !question ||
    options.length < 2 ||
    options.length > 4 ||
    options.some((option) => option === undefined) ||
    (candidate.multiSelect !== undefined &&
      typeof candidate.multiSelect !== "boolean")
  ) {
    return undefined;
  }
  const verifiedOptions = options as AgentQuestionOptionV1[];
  if (
    new Set(verifiedOptions.map((option) => option.key)).size !==
      verifiedOptions.length ||
    verifiedOptions.filter((option) => option.recommended).length > 1
  ) {
    return undefined;
  }
  return Object.freeze({
    key,
    header,
    question,
    ...(candidate.multiSelect === true ? { multiSelect: true } : {}),
    options: Object.freeze(verifiedOptions),
  });
}

export function parseAgentQuestionRequest(
  value: unknown,
): AgentQuestionRequestV1 {
  const candidate = record(value);
  if (
    !candidate ||
    Object.keys(candidate).some((key) => key !== "questions") ||
    !Array.isArray(candidate.questions) ||
    candidate.questions.length < 1 ||
    candidate.questions.length > 3
  ) {
    throw Object.assign(new Error("Question input is invalid."), {
      code: "agent.question_invalid_input",
      effect: "not_started",
    });
  }
  const questions = candidate.questions.map(parseQuestion);
  if (
    questions.some((question) => question === undefined) ||
    new Set(questions.map((question) => question?.key)).size !==
      questions.length
  ) {
    throw Object.assign(new Error("Question input is invalid."), {
      code: "agent.question_invalid_input",
      effect: "not_started",
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "question",
    questions: Object.freeze(questions as AgentQuestionItemV1[]),
  });
}

export function assertAgentQuestionResponse(
  request: AgentQuestionRequestV1,
  response: AgentQuestionResponseV1,
): AgentQuestionResponseV1 {
  if (response.outcome !== "submitted") return response;
  if (
    response.answers.length !== request.questions.length ||
    response.supplement?.trim().length === 0 ||
    (response.supplement?.trim().length ?? 0) > 1_000
  ) {
    throw new Error("Question response is invalid.");
  }
  const answerByQuestion = new Map(
    response.answers.map((answer) => [answer.questionKey, answer]),
  );
  if (answerByQuestion.size !== request.questions.length) {
    throw new Error("Question response is invalid.");
  }
  for (const question of request.questions) {
    const answer = answerByQuestion.get(question.key);
    if (!answer) throw new Error("Question response is invalid.");
    const optionKeys = [...new Set(answer.optionKeys)];
    const allowedOptions = new Set(
      question.options.map((option) => option.key),
    );
    const customText = answer.customText?.trim();
    if (
      optionKeys.length !== answer.optionKeys.length ||
      optionKeys.some((key) => !allowedOptions.has(key)) ||
      (!question.multiSelect && optionKeys.length > 1) ||
      (optionKeys.length === 0 && !customText) ||
      (customText?.length ?? 0) > 1_000
    ) {
      throw new Error("Question response is invalid.");
    }
  }
  return response;
}

export const agentBuiltinToolInstructions = Object.freeze([
  "Use ask_question only when a short clarification would materially change the result; proceed with a reasonable assumption when it would not.",
  "ask_question must be the only Tool call in its model step. Ask at most three focused questions, keep options distinct, and wait after calling it.",
  "The interface handles question submission, skipping, and cancellation. Never ask the user to call lifecycle Tools or expose interaction identifiers.",
]);

const askQuestionDefinition = Object.freeze({
  key: askQuestionToolKey,
  modelName: askQuestionToolName,
  revision: 1,
  lifecycle: "wait_for_user" as const,
  description:
    "Ask the user one to three focused clarifying questions with two to four choices each, optional multi-select, and a custom-answer path. Use only when the answer materially changes the work.",
  inputSchema: questionInputSchema,
  outputSchema: questionOutputSchema,
  usageInstructions: agentBuiltinToolInstructions,
}) satisfies AgentBuiltinToolDefinition;

export const agentBuiltinToolDefinitions: readonly AgentBuiltinToolDefinition[] =
  Object.freeze([askQuestionDefinition]);

export function agentBuiltinToolViewDigest(
  digest: (value: unknown) => string,
  businessToolViewDigest: string,
): string {
  return digest({
    schemaVersion: 1,
    builtinToolViewRevision: agentBuiltinToolViewRevision,
    businessToolViewDigest,
    skillToolAdapterRevision: "mastra-workspace-skills/v1",
    tools: agentBuiltinToolDefinitions.map((definition) => ({
      key: definition.key,
      modelName: definition.modelName,
      revision: definition.revision,
      lifecycle: definition.lifecycle,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      usageInstructions: definition.usageInstructions,
    })),
  });
}

function checkpointMessages(value: readonly unknown[]): readonly unknown[] {
  const serialized = JSON.stringify(value);
  if (
    serialized.length === 0 ||
    serialized.length > maximumCheckpointCharacters
  ) {
    throw Object.assign(new Error("Agent continuation is too large."), {
      code: "agent.continuation_too_large",
      effect: "not_started",
    });
  }
  return Object.freeze(JSON.parse(serialized) as unknown[]);
}

function lastMessageToolCalls(
  messages: readonly unknown[],
): readonly unknown[] {
  const last = record(messages.at(-1));
  const content = record(last?.content);
  if (!Array.isArray(content?.parts)) return [];
  // Mastra combines sequential steps into one assistant message. Only the
  // segment after its last step boundary belongs to the suspended step.
  const stepStart = content.parts.findLastIndex(
    (part) => record(part)?.type === "step-start",
  );
  return content.parts.slice(stepStart + 1).filter((part) => {
    const candidate = record(part);
    return candidate?.type === "tool-invocation";
  });
}

function checkpointMessageId(value: unknown): string | undefined {
  const id = record(value)?.id;
  return typeof id === "string" && validToolCallId(id) ? id : undefined;
}

function isCheckpointInputMessage(
  messageId: string,
  inputMessageIds: ReadonlySet<string>,
): boolean {
  if (inputMessageIds.has(messageId)) return true;
  const splitMarker = messageId.lastIndexOf("__split-");
  return (
    splitMarker > 0 && inputMessageIds.has(messageId.slice(0, splitMarker))
  );
}

function questionAlreadyAnswered(
  question: AgentQuestionItemV1,
  answered: readonly AgentAnsweredQuestionFact[],
): boolean {
  const offeredKeys = new Set(question.options.map((option) => option.key));
  const normalizedQuestion = question.question.replace(/\s+/gu, " ").trim();
  return answered.some(
    (fact) =>
      fact.questionKey === question.key &&
      (fact.selectedOptionKeys.length > 0
        ? fact.selectedOptionKeys.every((key) => offeredKeys.has(key))
        : Boolean(fact.customText) &&
          fact.question.replace(/\s+/gu, " ").trim() === normalizedQuestion),
  );
}

export function createAgentBuiltinToolSession(
  options: CreateAgentBuiltinToolSessionOptions = {},
): AgentBuiltinToolSession {
  let pending:
    | { readonly toolCallId: string; readonly request: AgentQuestionRequestV1 }
    | undefined;
  const askQuestion = createTool({
    id: askQuestionToolName,
    description: askQuestionDefinition.description,
    inputSchema: askQuestionDefinition.inputSchema,
    outputSchema: askQuestionDefinition.outputSchema,
    suspendSchema: askQuestionDefinition.inputSchema,
    resumeSchema: askQuestionDefinition.outputSchema,
    execute: async (input, context) => {
      const request = parseAgentQuestionRequest(input);
      if (
        request.questions.some((question) =>
          questionAlreadyAnswered(question, options.answeredQuestions ?? []),
        )
      ) {
        throw Object.assign(
          new Error("This question was already answered in the current Run."),
          {
            code: "agent.question_already_answered",
            effect: "not_started",
          },
        );
      }
      const agentContext = context.agent;
      if (
        !agentContext ||
        !validToolCallId(agentContext.toolCallId) ||
        pending
      ) {
        throw Object.assign(new Error("Question suspension is unavailable."), {
          code: "agent.question_suspension_unavailable",
          effect: "not_started",
        });
      }
      pending = Object.freeze({
        toolCallId: agentContext.toolCallId,
        request,
      });
      await agentContext.suspend(request);
    },
  });

  return Object.freeze({
    tools: Object.freeze({ [askQuestionToolName]: askQuestion }),
    suspension(options: Parameters<AgentBuiltinToolSession["suspension"]>[0]) {
      if (!pending) {
        if (options.finishReason === "suspended") {
          throw new Error("Agent suspended outside a Platform Built-in Tool.");
        }
        return undefined;
      }
      if (options.finishReason !== "suspended") {
        throw new Error("Question Tool did not suspend the Agent Run.");
      }
      const payload = record(options.suspendPayload);
      const stepCalls = lastMessageToolCalls(options.messages);
      const stepInvocation = record(record(stepCalls[0])?.toolInvocation);
      const inputMessageIds = new Set(options.inputMessageIds);
      const continuationMessages = options.messages.filter((message) => {
        const messageId = checkpointMessageId(message);
        return messageId
          ? !isCheckpointInputMessage(messageId, inputMessageIds)
          : true;
      });
      const invalidSuspension = (code: string, message: string): never => {
        throw Object.assign(new Error(message), {
          code,
          effect: "not_started",
        });
      };
      if (
        payload?.toolCallId !== pending.toolCallId ||
        payload.toolName !== askQuestionToolName
      ) {
        invalidSuspension(
          "agent.question_payload_mismatch",
          "Question suspension identity does not match its Tool call.",
        );
      }
      if (stepCalls.length > 1) {
        invalidSuspension(
          "agent.question_parallel_tool_calls",
          "Question Tool must be the only Tool in its model step.",
        );
      }
      if (
        stepCalls.length !== 1 ||
        stepInvocation?.toolCallId !== pending.toolCallId
      ) {
        invalidSuspension(
          "agent.question_call_mismatch",
          "Question Tool is missing from the suspended step.",
        );
      }
      if (
        inputMessageIds.size < 1 ||
        inputMessageIds.size !== options.inputMessageIds.length
      ) {
        invalidSuspension(
          "agent.question_input_identity_invalid",
          "Question input message identities are invalid.",
        );
      }
      if (continuationMessages.length < 1) {
        invalidSuspension(
          "agent.question_continuation_missing",
          "Question continuation messages are missing.",
        );
      }
      const checkpoint = Object.freeze({
        schemaVersion: 1 as const,
        adapter: "mastra-message-list-v2" as const,
        toolCallId: pending.toolCallId,
        toolName: askQuestionToolName,
        toolCallCount: options.previousToolCallCount + options.toolCalls.length,
        continuationMessages: checkpointMessages(continuationMessages),
      });
      return Object.freeze({
        toolCallId: pending.toolCallId,
        request: pending.request,
        checkpoint,
      });
    },
  });
}

function checkpoint(value: unknown): AgentRunContinuationCheckpointV1 {
  const candidate = record(value);
  if (
    candidate?.schemaVersion !== 1 ||
    candidate.adapter !== "mastra-message-list-v2" ||
    candidate.toolName !== askQuestionToolName ||
    typeof candidate.toolCallId !== "string" ||
    !validToolCallId(candidate.toolCallId) ||
    !Number.isSafeInteger(candidate.toolCallCount) ||
    Number(candidate.toolCallCount) < 1 ||
    !Array.isArray(candidate.continuationMessages)
  ) {
    throw new Error("Agent continuation checkpoint is invalid.");
  }
  return {
    schemaVersion: 1,
    adapter: "mastra-message-list-v2",
    toolCallId: candidate.toolCallId,
    toolName: askQuestionToolName,
    toolCallCount: Number(candidate.toolCallCount),
    continuationMessages: checkpointMessages(candidate.continuationMessages),
  };
}

export function resumeAgentQuestionCheckpoint(
  value: unknown,
  response: AgentQuestionResponseV1,
): {
  readonly messages: readonly unknown[];
  readonly previousToolCallCount: number;
  readonly questionOutcome: "submitted" | "skipped";
  readonly answeredQuestions: readonly AgentAnsweredQuestionFact[];
} {
  if (response.outcome === "cancelled") {
    throw new Error("A cancelled Agent Interaction cannot be resumed.");
  }
  const source = checkpoint(value);
  let resolved = 0;
  let answeredQuestions: readonly AgentAnsweredQuestionFact[] = [];
  const messages = source.continuationMessages.flatMap((message) => {
    const candidate = record(message);
    const content = record(candidate?.content);
    if (
      candidate?.role !== "assistant" ||
      !content ||
      !Array.isArray(content.parts)
    )
      return [];
    const parts = (content.parts as unknown[]).map((part: unknown): unknown => {
      const item = record(part);
      const invocation = record(item?.toolInvocation);
      if (
        item?.type !== "tool-invocation" ||
        invocation?.toolCallId !== source.toolCallId ||
        invocation.toolName !== askQuestionToolName
      ) {
        return part;
      }
      const request = parseAgentQuestionRequest(invocation.args);
      const verifiedResponse = assertAgentQuestionResponse(request, response);
      const answerByQuestion = new Map<string, AgentQuestionAnswerV1>(
        verifiedResponse.outcome === "submitted"
          ? verifiedResponse.answers.map(
              (answer) => [answer.questionKey, answer] as const,
            )
          : [],
      );
      answeredQuestions =
        verifiedResponse.outcome === "submitted"
          ? request.questions.map((question) => {
              const answer = answerByQuestion.get(question.key)!;
              return Object.freeze({
                questionKey: question.key,
                question: question.question,
                selectedOptionKeys: Object.freeze([...answer.optionKeys]),
                ...(answer.customText
                  ? { customText: answer.customText.trim() }
                  : {}),
              });
            })
          : [];
      const modelOutput =
        verifiedResponse.outcome === "submitted"
          ? {
              schemaVersion: 1,
              kind: "question_response",
              outcome: "submitted",
              answers: request.questions.map((question) => {
                const answer = answerByQuestion.get(question.key)!;
                return {
                  questionKey: question.key,
                  question: question.question,
                  selectedOptions: answer.optionKeys.map((key) => {
                    const option = question.options.find(
                      (candidate) => candidate.key === key,
                    )!;
                    return { key, label: option.label };
                  }),
                  ...(answer.customText
                    ? { customText: answer.customText.trim() }
                    : {}),
                };
              }),
              ...(verifiedResponse.supplement
                ? { supplement: verifiedResponse.supplement.trim() }
                : {}),
            }
          : {
              schemaVersion: 1,
              kind: "question_response",
              outcome: "skipped",
            };
      const providerMetadata = record(item.providerMetadata);
      const mastraMetadata = record(providerMetadata?.mastra);
      resolved += 1;
      return {
        ...item,
        providerMetadata: {
          ...providerMetadata,
          mastra: { ...mastraMetadata, modelOutput },
        },
        toolInvocation: {
          ...invocation,
          state: "result",
          result: verifiedResponse,
        },
      };
    });
    const metadata = record(content.metadata);
    const suspendedTools = record(metadata?.suspendedTools);
    const nextSuspendedTools = suspendedTools
      ? Object.fromEntries(
          Object.entries(suspendedTools).filter(
            ([toolCallId]) => toolCallId !== source.toolCallId,
          ),
        )
      : undefined;
    return [
      {
        ...candidate,
        ...(typeof candidate.createdAt === "string"
          ? { createdAt: new Date(candidate.createdAt) }
          : {}),
        content: {
          ...content,
          parts,
          ...(metadata
            ? {
                metadata: {
                  ...metadata,
                  ...(nextSuspendedTools &&
                  Object.keys(nextSuspendedTools).length > 0
                    ? { suspendedTools: nextSuspendedTools }
                    : { suspendedTools: undefined }),
                },
              }
            : {}),
        },
      },
    ];
  });
  if (resolved !== 1) {
    throw new Error("Agent continuation Tool Call could not be resolved.");
  }
  return Object.freeze({
    messages: Object.freeze(messages),
    previousToolCallCount: source.toolCallCount,
    questionOutcome: response.outcome,
    answeredQuestions: Object.freeze(answeredQuestions),
  });
}
