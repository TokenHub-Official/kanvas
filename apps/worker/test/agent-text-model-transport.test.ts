import type { ResolvedAgentModelBinding } from "@kanvas/database/runtime";
import type { KanvasAgentModelRequest } from "@kanvas/agent-runtime";
import type { ProviderSecretMaterialResolver } from "@kanvas/secrets";
import { describe, expect, it, vi } from "vitest";

import {
  agentReasoningEffort,
  agentWebSearchEnabled,
  createAgentTextModelTransport,
} from "../src/agent/agent-text-model-transport.js";
import { ProviderAdapterCallError } from "../src/provider/provider-adapter.js";
import type { ProviderHttpTransport } from "../src/provider/provider-http-transport.js";

const profileEvidence = [
  {
    kind: "administrator" as const,
    reference: "agent-model-test",
    observedAt: "2026-08-26T00:00:00.000Z",
    sourceDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    confidence: "high" as const,
    claim: "supported" as const,
  },
];

const route: ResolvedAgentModelBinding = {
  snapshot: { bindingKey: "agent-planner" },
  endpoint: {
    id: "01K00000000000000000000001",
    adapterKind: "openai_compatible",
    presetKind: "tokenhub",
    baseUrl: "https://provider.example/v1",
  },
  apiSurface: "chat.completions.v1",
  protocolKind: "openai_chat",
  providerModelId: "deepseek-v4-flash",
  modelProfile: {
    schemaVersion: 1,
    model: {
      displayName: "DeepSeek V4 Flash",
      family: "deepseek-v4",
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCall: true,
      structuredOutput: true,
    },
    operations: {
      "text.generate": {
        parameters: [
          {
            key: "responseFormat",
            label: "Structured output",
            required: false,
            valueType: "boolean",
            evidence: profileEvidence,
          },
        ],
        evidence: profileEvidence,
      },
    },
    sources: [
      {
        kind: "manual",
        reference: "agent-model-test",
        observedAt: profileEvidence[0]!.observedAt,
        sourceDigest: profileEvidence[0]!.sourceDigest,
      },
    ],
  },
  pricing: {},
  budgetAccountId: "01K00000000000000000000002",
  maximumCharge: { currencyCode: "USD", amount: "1" },
  secret: {
    id: "01K00000000000000000000003",
    workspaceId: "01K00000000000000000000004",
    credentialId: "01K00000000000000000000005",
    version: 1,
    materialGeneration: 1,
    sourceKind: "deployment_reference",
    lifecycleStatus: "active",
    aadDigest:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    materialFingerprint:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    formatVersion: 1,
    drainDeadlineAt: null,
    deploymentReference: "agent-provider-key",
  },
  executionDeadlineAt: new Date("2026-08-24T11:05:00.000Z"),
};

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

describe("Agent text model transport", () => {
  it.each([
    { maximum: undefined, explicit: undefined, expected: undefined },
    { maximum: undefined, explicit: 6000, expected: 6000 },
    { maximum: 16000, explicit: undefined, expected: 16000 },
    { maximum: 16000, explicit: 6000, expected: 6000 },
  ])(
    "resolves chat wire allowance $maximum / $explicit",
    async ({ maximum, explicit, expected }) => {
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              id: "completion-1",
              model: route.providerModelId,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Ready" },
                  finish_reason: "stop",
                },
              ],
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("test-key")),
        },
      });
      const profile = record(route.modelProfile);
      await transport.generate({
        route: {
          ...route,
          modelProfile: {
            ...profile,
            model: {
              ...record(profile.model),
              ...(maximum === undefined
                ? {}
                : { maximumOutputTokens: maximum }),
            },
          },
        },
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          tools: [],
          ...(explicit === undefined ? {} : { maxOutputTokens: explicit }),
        },
        signal: undefined,
      });
      expect(record(request.mock.calls[0]?.[0].body).max_tokens).toBe(expected);
    },
  );

  it("retries a pre-inference context rejection once using supplier token counts", async () => {
    const request = vi
      .fn<ProviderHttpTransport["request"]>()
      .mockResolvedValueOnce({
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            error: {
              code: "context_length_exceeded",
              message:
                "This model's maximum context length is 10000 tokens. However, you requested 13000 tokens (7000 in the messages, 6000 in the completion).",
            },
          }),
        ),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "completion-1",
            model: route.providerModelId,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Ready" },
                finish_reason: "stop",
              },
            ],
          }),
        ),
      });
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) => use(Buffer.from("test-key")),
      },
    });
    const response = await transport.generate({
      route,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "off", webSearchMode: "off" },
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Long prompt fixture" }],
          },
        ],
        tools: [],
        maxOutputTokens: 6000,
      },
      signal: undefined,
    });
    expect(response.finishReason).toBe("stop");
    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0]![0];
    const second = request.mock.calls[1]![0];
    expect(second).toEqual({
      ...first,
      body: { ...record(first.body), max_tokens: 3000 },
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 16001])(
    "rejects invalid model output allowance %s before HTTP",
    async (maxOutputTokens) => {
      const request = vi.fn<ProviderHttpTransport["request"]>();
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("test-key")),
        },
      });
      const profile = record(route.modelProfile);
      await expect(
        transport.generate({
          route: {
            ...route,
            modelProfile: {
              ...profile,
              model: { ...record(profile.model), maximumOutputTokens: 16000 },
            },
          },
          request: {
            schemaVersion: "kanvas.agent-model-request/v1",
            controls: { reasoningLevel: "off", webSearchMode: "off" },
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
            tools: [],
            maxOutputTokens,
          },
          signal: undefined,
        }),
      ).rejects.toMatchObject({ code: "agent.model_output_allowance_invalid" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    { statusCode: 400, code: "context_length_exceeded", expectedCalls: 2 },
    { statusCode: 400, code: "invalid_request", expectedCalls: 1 },
    { statusCode: 500, code: "context_length_exceeded", expectedCalls: 1 },
  ])(
    "never loops or retries ambiguous errors ($statusCode/$code)",
    async ({ statusCode, code, expectedCalls }) => {
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              error: {
                code,
                message:
                  "This model's maximum context length is 10000 tokens. However, you requested 13000 tokens (7000 in the messages, 6000 in the completion).",
              },
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("test-key")),
        },
      });
      await expect(
        transport.generate({
          route,
          request: {
            schemaVersion: "kanvas.agent-model-request/v1",
            controls: { reasoningLevel: "off", webSearchMode: "off" },
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
            tools: [],
            maxOutputTokens: 6000,
          },
          signal: undefined,
        }),
      ).rejects.toBeDefined();
      expect(request).toHaveBeenCalledTimes(expectedCalls);
    },
  );

  it("fails closed when an Agent Tool request uses a non-Tool model", async () => {
    const request = vi.fn<ProviderHttpTransport["request"]>();
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key")),
      },
    });
    const nonToolRoute = {
      ...route,
      modelProfile: {
        schemaVersion: 1,
        model: {
          slug: "plain-text-model",
          displayName: "Plain text model",
          family: "plain-text",
          description: "Text generation without Tool calls.",
          inputModalities: ["text"],
          outputModalities: ["text"],
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
        },
        operations: {
          "text.generate": {
            parameters: [],
            evidence: profileEvidence,
          },
        },
        sources: [
          {
            kind: "manual",
            reference: "plain-text-model",
            observedAt: "2026-08-26T00:00:00.000Z",
            sourceDigest:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;

    await expect(
      transport.generate({
        route: nonToolRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode: "off" },
          prompt: [
            { role: "user", content: [{ type: "text", text: "Use a Skill" }] },
          ],
          tools: [{ name: "skill", inputSchema: { type: "object" } }],
        },
        signal: undefined,
      }),
    ).rejects.toMatchObject({
      code: "agent.model_tool_calling_unsupported",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("enables reasoning only when the pinned model profile declares it", () => {
    const evidence = {
      kind: "administrator" as const,
      reference: "agent-model-test",
      observedAt: "2026-08-26T00:00:00.000Z",
      sourceDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      confidence: "high" as const,
      claim: "supported" as const,
    };
    const reasoningRoute = {
      ...route,
      modelProfile: {
        schemaVersion: 1,
        model: {
          displayName: "DeepSeek V4 Flash",
          family: "deepseek-v4",
          inputModalities: ["text"],
          outputModalities: ["text"],
          reasoning: true,
          toolCall: true,
        },
        operations: {
          "text.generate": {
            parameters: [
              {
                key: "reasoningEffort",
                label: "Reasoning effort",
                required: false,
                valueType: "enum",
                values: ["low", "medium", "high"],
                evidence: [evidence],
              },
            ],
            evidence: [evidence],
          },
        },
        sources: [
          {
            kind: "manual",
            reference: "agent-model-test",
            observedAt: evidence.observedAt,
            sourceDigest: evidence.sourceDigest,
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;

    expect(agentReasoningEffort(reasoningRoute)).toBe("medium");
    expect(
      agentReasoningEffort({
        ...reasoningRoute,
        modelProfile: {
          schemaVersion: 1,
          model: {
            slug: "deepseek-v4-flash",
            displayName: "DeepSeek V4 Flash",
            family: "deepseek-v4",
            description: "Canonical model.",
            inputModalities: ["text"],
            outputModalities: ["text"],
            contextWindow: 128_000,
            maximumOutputTokens: 8_192,
          },
          operations: {
            "text.generate": {
              parameters:
                reasoningRoute.modelProfile.operations["text.generate"]
                  .parameters,
              evidence: [evidence],
            },
          },
          sources: [
            {
              kind: "manual",
              reference: "deepseek-v4-flash",
              observedAt: evidence.observedAt,
              sourceDigest: evidence.sourceDigest,
            },
          ],
        },
      }),
    ).toBe("medium");
    expect(agentReasoningEffort(route)).toBeUndefined();
  });

  it.each([undefined, 16000])(
    "streams governed Responses with allowance %s",
    async (maximumOutputTokens) => {
      const evidence = {
        kind: "administrator" as const,
        reference: "agent-web-search-test",
        observedAt: "2026-08-26T00:00:00.000Z",
        sourceDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        confidence: "high" as const,
        claim: "supported" as const,
      };
      const responsesRoute = {
        ...route,
        endpoint: { ...route.endpoint, baseUrl: "https://provider.example" },
        apiSurface: "responses.v1" as const,
        protocolKind: "openai_responses" as const,
        modelProfile: {
          schemaVersion: 1,
          model: {
            displayName: "Search model",
            family: "search-model",
            ...(maximumOutputTokens === undefined
              ? {}
              : { maximumOutputTokens }),
            inputModalities: ["text"],
            outputModalities: ["text"],
            toolCall: true,
          },
          operations: {
            "text.generate": {
              parameters: [
                {
                  key: "webSearch",
                  label: "Web search",
                  required: false,
                  valueType: "boolean",
                  evidence: [evidence],
                },
              ],
              evidence: [evidence],
            },
          },
          sources: [
            {
              kind: "manual",
              reference: "agent-web-search-test",
              observedAt: evidence.observedAt,
              sourceDigest: evidence.sourceDigest,
            },
          ],
        },
      } satisfies ResolvedAgentModelBinding;
      const completed = {
        id: "resp-search-1",
        model: "search-model",
        output: [
          {
            type: "message",
            id: "msg-search-1",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Current result",
                annotations: [
                  {
                    type: "url_citation",
                    start_index: 0,
                    end_index: 14,
                    url: "https://example.com/current",
                    title: "Current source",
                  },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3 },
      };
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify(completed)),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("secret-key")),
        },
      });

      await expect(
        transport.generate({
          route: responsesRoute,
          request: {
            schemaVersion: "kanvas.agent-model-request/v1",
            controls: { reasoningLevel: "medium", webSearchMode: "auto" },
            prompt: [
              {
                role: "user",
                content: [{ type: "text", text: "Latest news" }],
              },
            ],
            tools: [],
          },
          signal: undefined,
        }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "Current result" }],
        sources: [
          { url: "https://example.com/current", title: "Current source" },
        ],
      });
      expect(agentWebSearchEnabled(responsesRoute)).toBe(true);
      const outbound = request.mock.calls[0]?.[0];
      expect(outbound?.baseUrl).toBe("https://provider.example/v1");
      expect(outbound?.path).toBe("/responses");
      expect(record(outbound?.body).max_output_tokens).toBe(
        maximumOutputTokens,
      );
      expect(record(outbound?.body)?.tools).toContainEqual({
        type: "web_search",
      });

      for (const webSearchMode of ["auto", "required"] as const) {
        await expect(
          transport.generate({
            route: responsesRoute,
            request: {
              schemaVersion: "kanvas.agent-model-request/v1",
              controls: { reasoningLevel: "medium", webSearchMode },
              prompt: [
                {
                  role: "user",
                  content: [{ type: "text", text: "Close this turn" }],
                },
              ],
              tools: [],
              toolChoice: { type: "none" },
            },
            signal: undefined,
          }),
        ).resolves.toMatchObject({
          content: [{ type: "text", text: "Current result" }],
        });
        const finalStepBody = record(request.mock.calls.at(-1)?.[0].body);
        expect(finalStepBody.tools ?? []).not.toContainEqual({
          type: "web_search",
        });
      }
    },
  );

  it.each(["attachment", "skill"] as const)(
    "keeps %s images on the wire when a vision model has reasoning enabled",
    async (source) => {
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              id: "vision-result",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { content: "orange wordmark" },
                },
              ],
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("test-key")),
        },
      });
      const visionRoute: ResolvedAgentModelBinding = {
        ...route,
        providerModelId: "vision-reasoning",
        modelProfile: {
          schemaVersion: 1,
          model: {
            slug: "vision-reasoning",
            displayName: "Vision reasoning",
            family: "vision",
            description: "Test model",
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            contextWindow: 128000,
            maximumOutputTokens: 8192,
            reasoning: true,
            toolCall: true,
          },
          operations: {
            "text.generate": { parameters: [], evidence: profileEvidence },
          },
          sources: [
            {
              kind: "manual",
              reference: "vision-test",
              observedAt: profileEvidence[0]!.observedAt,
              sourceDigest: profileEvidence[0]!.sourceDigest,
            },
          ],
        },
      };
      const prompt: KanvasAgentModelRequest["prompt"] =
        source === "attachment"
          ? [
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    data: new Uint8Array([1, 2, 3]),
                    mediaType: "image/png",
                  },
                ],
              },
            ]
          : [
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolName: "skill_read",
                    toolCallId: "image-1",
                    output: {
                      type: "content",
                      value: [
                        {
                          type: "image-data",
                          data: "AQID",
                          mediaType: "image/png",
                        },
                      ],
                    },
                  },
                ],
              },
            ];
      await transport.generate({
        route: visionRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "medium", webSearchMode: "off" },
          prompt,
          tools: [],
        },
        signal: undefined,
      });
      const body = record(request.mock.calls[0]?.[0].body);
      const messages = body.messages as { role: string; content: unknown }[];
      const parts = messages.flatMap((message) =>
        Array.isArray(message.content) ? (message.content as unknown[]) : [],
      );
      expect(parts).toContainEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,AQID" },
      });
    },
  );

  it("uses callback-scoped secret material and normalizes Chat Completions", async () => {
    const request = vi.fn<ProviderHttpTransport["request"]>(() =>
      Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "response-1",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { content: "Plan ready." },
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 8,
              prompt_tokens_details: { cached_tokens: 6 },
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          }),
        ),
      }),
    );
    const withResolvedMaterial: ProviderSecretMaterialResolver["withResolvedMaterial"] =
      (_metadata, use) => use(Buffer.from("secret-key", "utf8"));
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: { withResolvedMaterial },
    });

    await expect(
      transport.generate({
        route: {
          ...route,
          endpoint: { ...route.endpoint, baseUrl: "https://provider.example" },
        },
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "medium", webSearchMode: "off" },
          prompt: [
            { role: "system", content: "Plan the task." },
            { role: "system", content: "Use only available tools." },
            {
              role: "user",
              content: [{ type: "text", text: "Create a poster." }],
            },
          ],
          tools: [],
          responseFormat: {
            type: "json",
            schema: {
              type: "object",
              properties: { summary: { type: "string" } },
            },
          },
        },
        signal: undefined,
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "Plan ready." }],
      finishReason: "stop",
      usage: {
        inputTokens: 20,
        inputTokensNoCache: 14,
        cacheReadTokens: 6,
        outputTokens: 8,
        outputTextTokens: 6,
        reasoningTokens: 2,
      },
    });
    const outbound = request.mock.calls[0]?.[0];
    expect(outbound?.baseUrl).toBe("https://provider.example/v1");
    expect(outbound?.path).toBe("/chat/completions");
    expect(outbound?.headers.authorization).toBe("Bearer secret-key");
    expect(record(outbound?.body)?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "response",
        strict: true,
        schema: {
          type: "object",
          properties: { summary: { type: "string" } },
        },
      },
    });
    const outboundMessages = record(outbound?.body)?.messages;
    expect(outboundMessages).toBeInstanceOf(Array);
    expect(record((outboundMessages as unknown[])[0])?.content).toBe(
      "Plan the task.",
    );
  });

  it("streams text deltas while retaining the final governed response", async () => {
    const chunks = [
      'data: {"id":"response-2","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"lo","reasoning_content":"Checked the request."},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ];
    const request = vi.fn<ProviderHttpTransport["request"]>(() => {
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "text/event-stream" },
        body: Buffer.from(chunks.join(""), "utf8"),
      });
    });
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });

    const result = await transport.stream({
      route: { ...route, protocolKind: "deepseek_chat" },
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        tools: [],
        maxOutputTokens: 7000,
      },
      signal: undefined,
    });
    const parts = [];
    for await (const part of result.stream) parts.push(part);
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text-delta", delta: "Hel" }),
        expect.objectContaining({ type: "text-delta", delta: "lo" }),
        expect.objectContaining({
          type: "reasoning-delta",
          delta: "Checked the request.",
        }),
        expect.objectContaining({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
        }),
      ]),
    );
    expect(record(request.mock.calls[0]?.[0].body)?.stream).toBe(true);
    expect(record(request.mock.calls[0]?.[0].body).max_tokens).toBe(7000);
  });

  it("maps evidence-backed DeepSeek reasoning to its binary thinking control", async () => {
    const reasoningRoute = {
      ...route,
      protocolKind: "deepseek_chat" as const,
      modelProfile: {
        schemaVersion: 1 as const,
        model: {
          slug: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          family: "deepseek-v4",
          description: "Test reasoning model.",
          inputModalities: ["text" as const],
          outputModalities: ["text" as const],
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
          reasoning: true,
          toolCall: true,
        },
        operations: {
          "text.generate": { parameters: [], evidence: profileEvidence },
        },
        sources: [
          {
            kind: "manual" as const,
            reference: "deepseek-v4-flash",
            observedAt: profileEvidence[0]!.observedAt,
            sourceDigest: profileEvidence[0]!.sourceDigest,
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;
    const request = vi.fn<ProviderHttpTransport["request"]>(() =>
      Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            choices: [
              { index: 0, finish_reason: "stop", message: { content: "Done" } },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 1 },
          }),
        ),
      }),
    );
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("deepseek-key", "utf8")),
      },
    });
    const invoke = (reasoningLevel: "off" | "medium") =>
      transport.generate({
        route: reasoningRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel, webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Plan" }] }],
          tools: [],
        },
        signal: undefined,
      });

    await invoke("medium");
    await invoke("off");

    expect(record(request.mock.calls[0]?.[0].body)?.thinking).toEqual({
      type: "enabled",
    });
    expect(record(request.mock.calls[1]?.[0].body)?.thinking).toEqual({
      type: "disabled",
    });
    for (const call of request.mock.calls)
      expect(record(call[0].body).max_tokens).toBe(8192);
  });

  it("preserves gateway reasoning across a tool turn without an effort enum", async () => {
    const reasoningRoute = {
      ...route,
      modelProfile: {
        schemaVersion: 1 as const,
        model: {
          slug: "deepseek/deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          family: "deepseek-v4",
          description: "Gateway reasoning model.",
          inputModalities: ["text" as const],
          outputModalities: ["text" as const],
          contextWindow: 1_000_000,
          maximumOutputTokens: 384_000,
          reasoning: true,
          toolCall: true,
        },
        operations: {
          "text.generate": { parameters: [], evidence: profileEvidence },
        },
        sources: [
          {
            kind: "manual" as const,
            reference: "deepseek/deepseek-v4-flash",
            observedAt: profileEvidence[0]!.observedAt,
            sourceDigest: profileEvidence[0]!.sourceDigest,
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;
    let requestNumber = 0;
    const request = vi.fn<ProviderHttpTransport["request"]>(() => {
      requestNumber += 1;
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify(
            requestNumber === 1
              ? {
                  choices: [
                    {
                      index: 0,
                      finish_reason: "tool_calls",
                      message: {
                        content: "",
                        reasoning_content: "Inspect the current thread.",
                        tool_calls: [
                          {
                            id: "call-1",
                            type: "function",
                            function: {
                              name: "thread_inspect-work",
                              arguments: "{}",
                            },
                          },
                        ],
                      },
                    },
                  ],
                  usage: { prompt_tokens: 10, completion_tokens: 4 },
                }
              : {
                  choices: [
                    {
                      index: 0,
                      finish_reason: "stop",
                      message: { content: "One task." },
                    },
                  ],
                  usage: { prompt_tokens: 14, completion_tokens: 2 },
                },
          ),
        ),
      });
    });
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });
    const first = await transport.generate({
      route: reasoningRoute,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [
          { role: "user", content: [{ type: "text", text: "Inspect" }] },
        ],
        tools: [
          {
            name: "thread_inspect-work",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
      signal: undefined,
    });
    expect(first.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          text: "Inspect the current thread.",
        }),
        expect.objectContaining({
          type: "tool-call",
          toolCallId: "call-1",
        }),
      ]),
    );

    await transport.generate({
      route: reasoningRoute,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [
          { role: "assistant", content: first.content },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "thread_inspect-work",
                output: { type: "text", value: "one task" },
              },
            ],
          },
        ],
        tools: [],
      },
      signal: undefined,
    });

    const secondBody = record(request.mock.calls[1]?.[0].body);
    expect(secondBody.reasoning_effort).toBeUndefined();
    expect(secondBody.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "thread_inspect-work", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "one task" },
    ]);
  });

  it("keeps DeepSeek reasoning and tool calls in one assistant message", async () => {
    const request = vi.fn<ProviderHttpTransport["request"]>(() =>
      Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            choices: [
              { index: 0, finish_reason: "stop", message: { content: "Done" } },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
          }),
        ),
      }),
    );
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });

    await transport.generate({
      route: { ...route, protocolKind: "deepseek_chat" },
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "Use the matching skill." },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "load-skill",
                input: { name: "poster" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "load-skill",
                output: { type: "text", value: "Skill loaded." },
              },
            ],
          },
        ],
        tools: [],
      },
      signal: undefined,
    });

    expect(record(request.mock.calls[0]?.[0].body)?.messages).toEqual([
      {
        role: "assistant",
        content: "",
        reasoning_content: "Use the matching skill.",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "load-skill", arguments: '{"name":"poster"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "Skill loaded." },
    ]);

    request.mockClear();
    await transport.generate({
      route: { ...route, protocolKind: "openai_chat" },
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [
          {
            role: "assistant",
            content: [{ type: "reasoning", text: "Do not serialize me." }],
          },
        ],
        tools: [],
      },
      signal: undefined,
    });
    expect(record(request.mock.calls[0]?.[0].body)?.messages).toEqual([
      { role: "assistant", content: "" },
    ]);
  });

  it.each([undefined, 16000])(
    "preserves Gemini thought signatures and allowance %s",
    async (maximumOutputTokens) => {
      const geminiRoute = {
        ...route,
        endpoint: {
          ...route.endpoint,
          adapterKind: "gemini_native",
          presetKind: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com",
        },
        apiSurface: "generate-content.v1" as const,
        protocolKind: "gemini_generate_content" as const,
        providerModelId: "gemini-3-pro",
        modelProfile: {
          ...record(route.modelProfile),
          model: {
            ...record(record(route.modelProfile).model),
            ...(maximumOutputTokens === undefined
              ? {}
              : { maximumOutputTokens }),
          },
        },
      } satisfies ResolvedAgentModelBinding;
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          name: "load_skill",
                          args: { name: "poster" },
                        },
                        thoughtSignature: "signed-thought-1",
                      },
                    ],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 7,
                candidatesTokenCount: 2,
                thoughtsTokenCount: 3,
              },
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("gemini-key", "utf8")),
        },
      });

      const response = await transport.generate({
        route: geminiRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Plan" }] }],
          tools: [
            {
              name: "load_skill",
              inputSchema: { type: "object" },
            },
          ],
        },
        signal: undefined,
      });

      expect(response).toMatchObject({
        finishReason: "tool-calls",
        content: [
          {
            type: "tool-call",
            toolName: "load_skill",
            providerMetadata: {
              google: {
                thoughtSignature: "signed-thought-1",
              },
            },
          },
        ],
        usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 3 },
      });
      const outbound = request.mock.calls[0]?.[0];
      expect(outbound?.baseUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta",
      );
      expect(outbound?.path).toBe("/models/gemini-3-pro:generateContent");
      expect(
        record(record(outbound?.body).generationConfig).maxOutputTokens,
      ).toBe(maximumOutputTokens);
      expect(outbound?.headers["x-goog-api-key"]).toBe("gemini-key");
      expect(
        record(record(outbound?.body)?.generationConfig)?.thinkingConfig,
      ).toBeUndefined();
    },
  );

  it("only disables Gemini reasoning when the profile proves reasoning support", async () => {
    const reasoningRoute = {
      ...route,
      endpoint: {
        ...route.endpoint,
        adapterKind: "gemini_native",
        presetKind: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
      apiSurface: "generate-content.v1" as const,
      protocolKind: "gemini_generate_content" as const,
      providerModelId: "gemini-3-pro",
      modelProfile: {
        schemaVersion: 1 as const,
        model: {
          slug: "gemini-3-pro",
          displayName: "Gemini 3 Pro",
          family: "gemini-3",
          description: "Test reasoning model.",
          inputModalities: ["text" as const],
          outputModalities: ["text" as const],
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
          reasoning: true,
          toolCall: true,
        },
        operations: {
          "text.generate": { parameters: [], evidence: profileEvidence },
        },
        sources: [
          {
            kind: "manual" as const,
            reference: "gemini-3-pro",
            observedAt: profileEvidence[0]!.observedAt,
            sourceDigest: profileEvidence[0]!.sourceDigest,
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;
    const request = vi.fn<ProviderHttpTransport["request"]>(() =>
      Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { role: "model", parts: [{ text: "Observed" }] },
              },
            ],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1 },
          }),
        ),
      }),
    );
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("gemini-key", "utf8")),
      },
    });
    const invoke = (reasoningLevel: "off" | "medium") =>
      transport.generate({
        route: reasoningRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel, webSearchMode: "off" },
          prompt: [
            { role: "user", content: [{ type: "text", text: "Observe" }] },
          ],
          tools: [],
        },
        signal: undefined,
      });

    await invoke("medium");
    await invoke("off");

    expect(
      record(record(request.mock.calls[0]?.[0].body)?.generationConfig)
        ?.thinkingConfig,
    ).toBeUndefined();
    expect(
      record(request.mock.calls[1]?.[0].body)?.generationConfig,
    ).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it("projects trusted images only to models with evidence-backed image input", async () => {
    const geminiRoute = (acceptsImages: boolean) =>
      ({
        ...route,
        endpoint: {
          ...route.endpoint,
          adapterKind: "gemini_native",
          presetKind: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com",
        },
        apiSurface: "generate-content.v1" as const,
        protocolKind: "gemini_generate_content" as const,
        providerModelId: "gemini-3-pro",
        modelProfile: {
          schemaVersion: 1 as const,
          model: {
            slug: "gemini-3-pro",
            displayName: "Gemini 3 Pro",
            family: "gemini-3",
            description: "Test model.",
            inputModalities: acceptsImages
              ? (["text", "image"] as const)
              : (["text"] as const),
            outputModalities: ["text"] as const,
            contextWindow: 128_000,
            maximumOutputTokens: 8_192,
            attachment: acceptsImages,
            reasoning: true,
            toolCall: true,
            structuredOutput: true,
          },
          operations: {
            "text.generate": {
              parameters: [],
              evidence: profileEvidence,
            },
          },
          sources: [
            {
              kind: "manual" as const,
              reference: "gemini-image-input-test",
              observedAt: profileEvidence[0]!.observedAt,
              sourceDigest: profileEvidence[0]!.sourceDigest,
            },
          ],
        },
      }) satisfies ResolvedAgentModelBinding;
    const invoke = async (acceptsImages: boolean) => {
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { role: "model", parts: [{ text: "Observed" }] },
                },
              ],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 1,
              },
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("gemini-key", "utf8")),
        },
      });
      await transport.generate({
        route: geminiRoute(acceptsImages),
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode: "off" },
          prompt: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe the reference." },
                {
                  type: "file",
                  data: new URL("https://storage.example/signed-reference"),
                  mediaType: "image/png",
                  filename: "reference.png",
                },
              ],
            },
          ],
          tools: [],
          maxOutputTokens: 2_048,
          temperature: 0.4,
          topP: 0.9,
        },
        signal: undefined,
      });
      return request.mock.calls[0]?.[0].body;
    };

    expect(JSON.stringify(await invoke(false))).not.toContain(
      "signed-reference",
    );
    const visualRequest = record(await invoke(true));
    expect(JSON.stringify(visualRequest)).toContain("signed-reference");
    expect(record(visualRequest.generationConfig)).toMatchObject({
      maxOutputTokens: 2_048,
    });
    expect(record(visualRequest.generationConfig).temperature).toBeUndefined();
    expect(record(visualRequest.generationConfig).topP).toBeUndefined();
  });

  it("falls back from Gemini native search to the governed search tool when function tools coexist", async () => {
    const searchRoute = {
      ...route,
      endpoint: {
        ...route.endpoint,
        adapterKind: "gemini_native",
        presetKind: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
      apiSurface: "generate-content.v1" as const,
      protocolKind: "gemini_generate_content" as const,
      providerModelId: "gemini-3-pro",
      modelProfile: {
        schemaVersion: 1 as const,
        model: {
          slug: "gemini-3-pro",
          displayName: "Gemini 3 Pro",
          family: "gemini-3",
          description: "Test model.",
          inputModalities: ["text"] as const,
          outputModalities: ["text"] as const,
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
          reasoning: true,
          toolCall: true,
          structuredOutput: true,
        },
        operations: {
          "text.generate": {
            parameters: [
              {
                key: "webSearch",
                label: "Web search",
                required: false,
                valueType: "boolean" as const,
                evidence: profileEvidence,
              },
            ],
            evidence: profileEvidence,
          },
        },
        sources: [
          {
            kind: "manual" as const,
            reference: "gemini-search-conflict-test",
            observedAt: profileEvidence[0]!.observedAt,
            sourceDigest: profileEvidence[0]!.sourceDigest,
          },
        ],
      },
    } satisfies ResolvedAgentModelBinding;
    const invoke = async (
      webSearchMode: "auto" | "off" | "required",
      webSearchToolAvailable = true,
    ) => {
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { role: "model", parts: [{ text: "Observed" }] },
                },
              ],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 1,
              },
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("gemini-key", "utf8")),
        },
      });
      await transport.generate({
        route: searchRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode },
          webSearchToolAvailable,
          prompt: [
            { role: "user", content: [{ type: "text", text: "Research" }] },
          ],
          tools: [
            { name: "load_skill", inputSchema: { type: "object" } },
            { name: "web_search", inputSchema: { type: "object" } },
          ],
        },
        signal: undefined,
      });
      return JSON.stringify(request.mock.calls[0]?.[0].body);
    };

    const toolFallback = await invoke("auto");
    expect(toolFallback).toContain("web_search");
    expect(toolFallback).toContain("load_skill");
    expect(toolFallback).not.toContain("googleSearch");
    expect(await invoke("off")).not.toContain("web_search");
    expect(await invoke("auto", false)).not.toContain("web_search");
    await expect(invoke("required", false)).rejects.toMatchObject({
      code: "agent.model_web_search_unsupported",
    });
  });

  it("preserves OpenAI Responses reasoning items across a tool turn", async () => {
    const responsesRoute = {
      ...route,
      apiSurface: "responses.v1" as const,
      protocolKind: "openai_responses" as const,
      providerModelId: "gpt-5.6-sol",
    } satisfies ResolvedAgentModelBinding;
    const request = vi
      .fn<ProviderHttpTransport["request"]>()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "resp-1",
            output: [
              {
                type: "reasoning",
                id: "rs_1",
                encrypted_content: "encrypted-reasoning-1",
                summary: [{ type: "summary_text", text: "Use the tool." }],
              },
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call-1",
                name: "load_skill",
                arguments: '{"name":"poster"}',
              },
            ],
            usage: { input_tokens: 8, output_tokens: 4 },
          }),
        ),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "resp-2",
            output: [
              {
                type: "message",
                id: "msg_2",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Done",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 1 },
          }),
        ),
      });
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });
    const first = await transport.generate({
      route: responsesRoute,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Plan" }] }],
        tools: [],
        responseFormat: { type: "json" },
      },
      signal: undefined,
    });
    await transport.generate({
      route: responsesRoute,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [
          { role: "assistant", content: first.content },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "load_skill",
                output: { type: "text", value: "loaded" },
              },
            ],
          },
        ],
        tools: [],
        responseFormat: { type: "json" },
      },
      signal: undefined,
    });

    expect(first.content[0]).toMatchObject({
      type: "reasoning",
      providerMetadata: {
        openai: {
          itemId: "rs_1",
          reasoningEncryptedContent: "encrypted-reasoning-1",
        },
      },
    });
    expect(record(request.mock.calls[1]?.[0].body)?.input).toContainEqual({
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "encrypted-reasoning-1",
      summary: [{ type: "summary_text", text: "Use the tool." }],
    });
  });

  it("rejects a mismatched protocol before sending a Provider request", async () => {
    const request = vi.fn<ProviderHttpTransport["request"]>();
    const transport = createAgentTextModelTransport({
      http: { request },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });
    await expect(
      transport.generate({
        route: { ...route, protocolKind: "openai_responses" },
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "medium", webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          tools: [],
        },
        signal: undefined,
      }),
    ).rejects.toMatchObject({
      code: "agent.model_surface_unsupported",
      effect: "not_started",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([undefined, 2_048])(
    "maps native Anthropic reasoning with total allowance %s",
    async (maxOutputTokens) => {
      const anthropicRoute = {
        ...route,
        endpoint: {
          ...route.endpoint,
          adapterKind: "anthropic_native",
          presetKind: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
        },
        apiSurface: "messages.v1" as const,
        protocolKind: "anthropic_messages" as const,
        providerModelId: "claude-sonnet-4-6",
        modelProfile: {
          schemaVersion: 1 as const,
          model: {
            slug: "claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            family: "claude-sonnet",
            description: "Reasoning model.",
            inputModalities: ["text" as const],
            outputModalities: ["text" as const],
            contextWindow: 200_000,
            maximumOutputTokens: 64_000,
            reasoning: true,
            toolCall: true,
          },
          operations: {
            "text.generate": {
              parameters: [
                {
                  key: "reasoningEffort",
                  label: "Reasoning effort",
                  required: false,
                  valueType: "enum" as const,
                  values: ["low", "medium", "high"],
                  evidence: profileEvidence,
                },
                {
                  key: "webSearch",
                  label: "Web search",
                  required: false,
                  valueType: "boolean" as const,
                  evidence: profileEvidence,
                },
              ],
              evidence: profileEvidence,
            },
          },
          sources: [
            {
              kind: "manual" as const,
              reference: "claude-sonnet-4-6",
              observedAt: profileEvidence[0]!.observedAt,
              sourceDigest: profileEvidence[0]!.sourceDigest,
            },
          ],
        },
      } satisfies ResolvedAgentModelBinding;
      const request = vi.fn<ProviderHttpTransport["request"]>(() =>
        Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-6",
              content: [
                {
                  type: "thinking",
                  thinking: "Check the route.",
                  signature: "signed-reasoning",
                },
                { type: "text", text: "Ready" },
              ],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: {
                input_tokens: 9,
                output_tokens: 4,
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 3,
              },
            }),
          ),
        }),
      );
      const transport = createAgentTextModelTransport({
        http: { request },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("anthropic-key", "utf8")),
        },
      });

      const response = await transport.generate({
        route: anthropicRoute,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "medium", webSearchMode: "required" },
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          tools: [],
        },
        signal: undefined,
      });

      expect(response).toMatchObject({
        finishReason: "stop",
        content: [
          {
            type: "reasoning",
            text: "Check the route.",
            providerMetadata: {
              anthropic: { signature: "signed-reasoning" },
            },
          },
          { type: "text", text: "Ready" },
        ],
        usage: {
          inputTokens: 14,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
          outputTokens: 4,
        },
        responseId: "msg_1",
        resolvedModelId: "claude-sonnet-4-6",
      });
      const outbound = request.mock.calls[0]?.[0];
      expect(record(outbound?.body).max_tokens).toBe(maxOutputTokens ?? 64_000);
      expect(outbound?.path).toBe("/messages");
      expect(outbound?.headers["x-api-key"]).toBe("anthropic-key");
      expect(outbound?.headers["anthropic-version"]).toBe("2023-06-01");
      expect(record(outbound?.body)?.thinking).toEqual({
        type: "enabled",
        budget_tokens: 1024,
      });
      expect(record(outbound?.body)?.output_config).toEqual({
        effort: "medium",
      });
      expect(record(outbound?.body)?.tools).toContainEqual(
        expect.objectContaining({
          name: "web_search",
          type: "web_search_20250305",
        }),
      );
    },
  );

  it("classifies a synchronous 4xx rejection as not started", async () => {
    const transport = createAgentTextModelTransport({
      http: {
        request: () =>
          Promise.resolve({
            statusCode: 400,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                error: {
                  code: "unsupported_value",
                  type: "invalid_request_error",
                  param: "response_format",
                  message: "response_format json_schema is unsupported",
                },
              }),
            ),
          }),
      },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });
    await expect(
      transport.generate({
        route: { ...route, protocolKind: "deepseek_chat" },
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "medium", webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          tools: [],
        },
        signal: undefined,
      }),
    ).rejects.toMatchObject({
      code: "agent.model_provider_rejected_400_unsupported_value_response_format",
      effect: "not_started",
    });
  });

  it("preserves a governed Provider transport failure wrapped by the AI SDK", async () => {
    const transport = createAgentTextModelTransport({
      http: {
        request: () =>
          Promise.reject(
            new ProviderAdapterCallError(
              "provider.transport_failed",
              "not_started",
            ),
          ),
      },
      secrets: {
        withResolvedMaterial: (_metadata, use) =>
          use(Buffer.from("secret-key", "utf8")),
      },
    });

    await expect(
      transport.generate({
        route,
        request: {
          schemaVersion: "kanvas.agent-model-request/v1",
          controls: { reasoningLevel: "off", webSearchMode: "off" },
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          tools: [],
        },
        signal: undefined,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_failed",
      effect: "not_started",
    });
  });

  it.each([
    ["UND_ERR_CONNECT_TIMEOUT", "agent.model_provider_timeout"],
    ["ECONNRESET", "agent.model_provider_transport_failed"],
  ])(
    "classifies nested Provider transport code %s",
    async (transportCode, expectedCode) => {
      const transport = createAgentTextModelTransport({
        http: {
          request: () =>
            Promise.reject(
              Object.assign(new Error("Provider request failed."), {
                code: transportCode,
              }),
            ),
        },
        secrets: {
          withResolvedMaterial: (_metadata, use) =>
            use(Buffer.from("secret-key", "utf8")),
        },
      });

      await expect(
        transport.generate({
          route,
          request: {
            schemaVersion: "kanvas.agent-model-request/v1",
            controls: { reasoningLevel: "off", webSearchMode: "off" },
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
            tools: [],
          },
          signal: undefined,
        }),
      ).rejects.toMatchObject({
        code: expectedCode,
        effect: "unknown",
      });
    },
  );
});
