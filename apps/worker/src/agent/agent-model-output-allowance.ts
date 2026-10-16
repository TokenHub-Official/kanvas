import type { KanvasAgentModelRequest } from "@kanvas/agent-runtime";
import { parseModelProfileDocumentV1 } from "@kanvas/application";
import type { ResolvedAgentModelBinding } from "@kanvas/database/runtime";

/** Total completion allowance, including reasoning where the protocol shares it. */
export function agentModelOutputAllowance(
  route: Pick<ResolvedAgentModelBinding, "modelProfile">,
  request: Pick<KanvasAgentModelRequest, "maxOutputTokens">,
): number | undefined {
  const maximum = parseModelProfileDocumentV1(route.modelProfile).model
    .maximumOutputTokens;
  const explicit = request.maxOutputTokens;
  if (
    explicit !== undefined &&
    (!Number.isSafeInteger(explicit) ||
      explicit <= 0 ||
      (maximum !== undefined && explicit > maximum))
  ) {
    throw Object.assign(
      new Error(
        "Requested output allowance exceeds the model capability or is invalid.",
      ),
      {
        code: "agent.model_output_allowance_invalid",
        effect: "not_started",
      },
    );
  }
  return explicit ?? maximum;
}

/** Anthropic's SDK adds thinking tokens; the governed allowance includes them. */
export function applyAgentWireOutputAllowance(
  route: Pick<ResolvedAgentModelBinding, "modelProfile" | "protocolKind">,
  request: Pick<KanvasAgentModelRequest, "maxOutputTokens">,
  body: unknown,
): unknown {
  const allowance = agentModelOutputAllowance(route, request);
  if (allowance === undefined || route.protocolKind !== "anthropic_messages")
    return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const payload = body as Record<string, unknown>;
  const thinking = payload.thinking as
    { type?: string; budget_tokens?: number } | undefined;
  if (
    thinking?.type === "enabled" &&
    typeof thinking.budget_tokens === "number" &&
    thinking.budget_tokens >= allowance
  ) {
    throw Object.assign(
      new Error(
        "The thinking budget leaves no room within the output allowance.",
      ),
      {
        code: "agent.model_output_allowance_invalid",
        effect: "not_started",
      },
    );
  }
  return { ...payload, max_tokens: allowance };
}

/** Recover only an explicit pre-inference rejection with verifiable arithmetic.
 * No tokenizer guess, prompt mutation, generated-response replay, or retry loop.
 */
export function recoverAgentContextAllowance(
  body: unknown,
  rejection: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !rejection ||
    typeof rejection !== "object" ||
    Array.isArray(rejection)
  )
    return undefined;
  const payload = body as Record<string, unknown>;
  const error = (
    rejection as {
      error?: { code?: unknown; type?: unknown; message?: unknown };
    }
  ).error;
  if (typeof error?.message !== "string") return undefined;
  const key = ["max_completion_tokens", "max_output_tokens", "max_tokens"].find(
    (candidate) => typeof payload[candidate] === "number",
  );
  if (!key) return undefined;
  const current = payload[key];
  if (
    typeof current !== "number" ||
    !Number.isSafeInteger(current) ||
    current <= 0
  )
    return undefined;
  let input: number;
  let requested: number;
  let window: number;
  const anthropic =
    /input length and `?max_tokens`? exceed context limit:\s*(\d+)\s*\+\s*(\d+)\s*>\s*(\d+)/iu.exec(
      error.message,
    );
  if (anthropic && error.type === "invalid_request_error") {
    input = Number(anthropic[1]);
    requested = Number(anthropic[2]);
    window = Number(anthropic[3]);
  } else if (error.code === "context_length_exceeded") {
    const limit = /maximum context length is (\d+) tokens/iu.exec(
      error.message,
    );
    const total = /requested (\d+) tokens/iu.exec(error.message);
    const completion = /(\d+) (?:in|for) the completion/iu.exec(error.message);
    if (!limit || !total || !completion) return undefined;
    requested = Number(completion[1]);
    window = Number(limit[1]);
    input = Number(total[1]) - requested;
  } else return undefined;
  if (
    ![input, requested, window].every(Number.isSafeInteger) ||
    input < 0 ||
    requested !== current ||
    input + requested <= window
  )
    return undefined;
  const remaining = window - input;
  if (remaining <= 0 || remaining >= current) return undefined;
  const thinking = payload.thinking as
    { type?: string; budget_tokens?: number } | undefined;
  if (
    thinking?.type === "enabled" &&
    typeof thinking.budget_tokens === "number" &&
    thinking.budget_tokens >= remaining
  )
    return undefined;
  return { ...payload, [key]: remaining };
}
